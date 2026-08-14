import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { AssinaturasService } from './assinaturas.service';
import { AssinarDto } from './dto/assinatura.dto';
import { gerarReciboPdf } from './recibo.pdf';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/**
 * De onde partiu a assinatura. Atrás do nginx o IP do socket é o do próprio
 * proxy, então o que vale é o X-Forwarded-For — e dele só o primeiro endereço,
 * que é o de quem assinou; o resto da lista são os saltos até aqui.
 */
function origemDaRequisicao(req: Request): { ip?: string; userAgent?: string } {
  const encaminhado = req.headers['x-forwarded-for'];
  const cabecalho = Array.isArray(encaminhado) ? encaminhado[0] : encaminhado;
  const ip = cabecalho?.split(',')[0].trim() || req.ip;
  return { ip, userAgent: req.headers['user-agent'] };
}

/**
 * A coleta de assinatura do recibo da diária paga em mãos.
 *
 * Duas portas, de propósito: as rotas de `/diarias/...` são de quem paga e
 * pedem login; as de `/assinaturas/:token` são de quem recebe e não pedem
 * nada além do link — o diarista não tem conta aqui e não vai criar uma para
 * dizer que recebeu o dinheiro dele. O token é o que faz as vezes de senha,
 * por isso é sorteado grande, morre ao ser usado e vence em uma semana.
 */
@Controller()
export class AssinaturasController {
  constructor(private readonly service: AssinaturasService) {}

  // --- De quem paga (autenticado) ---

  /** Abre a coleta e devolve o link para mandar (ou abrir ali mesmo). */
  @Post('diarias/:id/assinatura')
  @HttpCode(201)
  async gerarLink(@Param('id') id: string, @Req() req: Request) {
    const a = await this.service.gerarLink(id, usuarioId(req));
    return { token: a.token, expiraEm: a.expiraEm, assinadoEm: a.assinadoEm };
  }

  /** O recibo guardado desta diária (null = ninguém coletou ainda). */
  @Get('diarias/:id/assinatura')
  async doDiaria(@Param('id') id: string) {
    const a = await this.service.doDiaria(id);
    if (!a) return null;
    return {
      token: a.token,
      expiraEm: a.expiraEm,
      assinadoEm: a.assinadoEm,
      nomeAssinante: a.nomeAssinante,
      assinaturaPng: a.assinaturaPng,
      modo: a.modo,
    };
  }

  /** O recibo em PDF, para baixar, imprimir e guardar. */
  @Get('diarias/:id/recibo.pdf')
  @Header('Content-Type', 'application/pdf')
  async recibo(@Param('id') id: string, @Res() res: Response) {
    const a = await this.service.paraRecibo(id);
    const pdf = await gerarReciboPdf({
      id: a.id,
      quemPaga: { nome: a.empresaNome, cnpj: a.empresaCnpj },
      quemRecebe: {
        nome: a.nomeAssinante ?? a.diaria.diarista.nome,
        cpfCnpj: a.cpfAssinante,
      },
      valor: Number(a.valor),
      descricao: a.descricao,
      detalhamento: a.detalhamento,
      dataDiaria: a.dataDiaria,
      assinadoEm: a.assinadoEm!,
      assinaturaPng: a.assinaturaPng!,
      modo: a.modo,
      ip: a.ip,
      userAgent: a.userAgent,
    });

    // `inline` abre na aba em vez de baixar direto: quem clica quer conferir o
    // recibo, e o botão de salvar do próprio visualizador dá conta do resto.
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${nomeDoArquivo(a.diaria.diarista.nome, a.dataDiaria)}"`,
    );
    res.send(pdf);
  }

  // --- De quem recebe (público, só com o link) ---

  @Public()
  @Get('assinaturas/:token')
  abrir(@Param('token') token: string) {
    return this.service.abrirPorToken(token);
  }

  @Public()
  @Post('assinaturas/:token')
  @HttpCode(200)
  assinar(
    @Param('token') token: string,
    @Body() dto: AssinarDto,
    @Req() req: Request,
  ) {
    return this.service.assinar(token, dto, origemDaRequisicao(req));
  }
}

/** "recibo-jose-da-silva-2026-08-14.pdf" — achável na pasta de downloads. */
function nomeDoArquivo(nome: string, data: Date): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `recibo-${limpo}-${data.toISOString().slice(0, 10)}.pdf`;
}
