import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  BaixarDinheiroDto,
  ConferirLancamentoDto,
  ContagemDaGavetaDto,
  EntregarDinheiroDto,
  FecharCaixaDto,
  NotaDto,
  PeriodoDoCaixaDto,
} from './dto/caixa.dto';
import { FechamentoCaixaService } from './fechamento-caixa.service';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/** A baixa no IXC é assinada: quem conferir o extrato de lá precisa saber quem. */
function usuarioNome(req: Request): string | undefined {
  return (req.user as { nome?: string } | undefined)?.nome;
}

/** Bater o caixa do dinheiro em mãos: conferir, fotografar a nota, fechar. */
@Controller('caixa')
export class FechamentoCaixaController {
  constructor(private readonly service: FechamentoCaixaService) {}

  /** Os caixas do IXC, para escolher qual bater. */
  @Get('caixas')
  caixas() {
    return this.service.listarCaixas();
  }

  /**
   * Em que tabela do IXC ele foi olhar e que colunas achou. Antes das rotas
   * com parâmetro, para não ser lida como um id de caixa.
   */
  @Get('diagnostico')
  diagnostico() {
    return this.service.diagnostico();
  }

  /** Os lançamentos do período, com o que já foi conferido e o que está na rua. */
  @Get(':caixaId/extrato')
  extrato(
    @Param('caixaId', ParseIntPipe) caixaId: number,
    @Query() query: PeriodoDoCaixaDto,
  ) {
    return this.service.extrato(caixaId, query.de, query.ate);
  }

  @Put(':caixaId/lancamentos/:idLancamento/conferir')
  @HttpCode(200)
  conferir(
    @Param('caixaId', ParseIntPipe) caixaId: number,
    @Param('idLancamento', ParseIntPipe) idLancamento: number,
    @Body() dto: ConferirLancamentoDto,
    @Req() req: Request,
  ) {
    return this.service.conferir(caixaId, idLancamento, dto, usuarioId(req));
  }

  @Put(':caixaId/lancamentos/:idLancamento/nota')
  @HttpCode(200)
  guardarNota(
    @Param('caixaId', ParseIntPipe) caixaId: number,
    @Param('idLancamento', ParseIntPipe) idLancamento: number,
    @Body() dto: NotaDto,
  ) {
    return this.service.guardarNota(caixaId, idLancamento, dto.notaFoto ?? null);
  }

  /** A foto, sob demanda: ela não vai na listagem para não pesar a tela. */
  @Get(':caixaId/lancamentos/:idLancamento/nota')
  nota(
    @Param('caixaId', ParseIntPipe) caixaId: number,
    @Param('idLancamento', ParseIntPipe) idLancamento: number,
  ) {
    return this.service.nota(caixaId, idLancamento);
  }

  // --- Dinheiro na rua ---

  @Post('dinheiro-na-rua')
  @HttpCode(201)
  entregar(@Body() dto: EntregarDinheiroDto, @Req() req: Request) {
    return this.service.entregar(dto, usuarioId(req));
  }

  @Get(':caixaId/dinheiro-na-rua')
  historicoDaRua(@Param('caixaId', ParseIntPipe) caixaId: number) {
    return this.service.historicoDaRua(caixaId);
  }

  @Post('dinheiro-na-rua/:id/baixar')
  @HttpCode(200)
  baixar(
    @Param('id') id: string,
    @Body() dto: BaixarDinheiroDto,
    @Req() req: Request,
  ) {
    return this.service.baixar(id, dto, usuarioId(req), usuarioNome(req));
  }

  @Get('dinheiro-na-rua/:id/nota')
  notaDaRua(@Param('id') id: string) {
    return this.service.notaDaRua(id);
  }

  @Delete('dinheiro-na-rua/:id')
  @HttpCode(200)
  async apagarEntrega(@Param('id') id: string) {
    await this.service.apagarEntrega(id);
    return { ok: true };
  }

  // --- Fechar ---

  @Post('fechar')
  @HttpCode(201)
  fechar(@Body() dto: FecharCaixaDto, @Req() req: Request) {
    return this.service.fechar(dto, usuarioId(req));
  }

  @Get(':caixaId/fechamentos')
  fechamentos(@Param('caixaId', ParseIntPipe) caixaId: number) {
    return this.service.listarFechamentos(caixaId);
  }

  /**
   * Corrige o que se contou na gaveta num fechamento já assinado — só no
   * último de cada caixa, que é o único de quem ninguém ainda dependeu.
   */
  @Put('fechamentos/:id/contagem')
  @HttpCode(200)
  corrigirContagem(
    @Param('id') id: string,
    @Body() dto: ContagemDaGavetaDto,
    @Req() req: Request,
  ) {
    return this.service.corrigirContagem(id, dto.saldoContado, usuarioId(req));
  }
}
