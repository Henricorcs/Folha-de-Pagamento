import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClasseTributo, Prisma, TipoGuia } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GravarGuiaDto } from './dto/guia.dto';
import { conferir, GuiaIlegivelError, GuiaLida, lerGuia } from './guias.parse';
import { extrairTextoPdf } from './pdf';

/** O que a tela mostra depois de ler o PDF, antes de alguém confirmar. */
export interface LeituraDaGuia {
  guia: GuiaLida;
  arquivoNome: string;
  textoOriginal: string;
  /** Soma dos itens não fechou com o total impresso — some quando está tudo certo. */
  divergencia: string | null;
  /** Guia igual já gravada; gravar de novo dobraria o valor no gráfico. */
  jaExiste: { id: string; competencia: string; valorTotal: number } | null;
}

@Injectable()
export class ImpostosService {
  private readonly logger = new Logger(ImpostosService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lê o PDF e devolve o que entendeu — **sem gravar nada**. Parser de PDF
   * erra, e isto é imposto: quem confere é a pessoa, na tela.
   */
  async ler(arquivo: Express.Multer.File): Promise<LeituraDaGuia> {
    const texto = await this.extrairTexto(arquivo);

    let guia: GuiaLida;
    try {
      guia = lerGuia(texto);
    } catch (err) {
      if (err instanceof GuiaIlegivelError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const existente = await this.prisma.guia.findFirst({
      where: {
        tipo: guia.tipo as TipoGuia,
        competencia: guia.competencia,
        numeroDocumento: guia.numeroDocumento,
      },
      select: { id: true, competencia: true, valorTotal: true },
    });

    return {
      guia,
      arquivoNome: arquivo.originalname,
      textoOriginal: texto,
      divergencia: conferir(guia),
      jaExiste: existente
        ? {
            id: existente.id,
            competencia: existente.competencia,
            valorTotal: Number(existente.valorTotal),
          }
        : null,
    };
  }

  private async extrairTexto(arquivo: Express.Multer.File): Promise<string> {
    if (!arquivo?.buffer?.length) {
      throw new BadRequestException('Nenhum arquivo recebido.');
    }
    try {
      const texto = await extrairTextoPdf(new Uint8Array(arquivo.buffer));
      if (!texto.trim()) {
        throw new BadRequestException(
          'O PDF não tem texto — parece ser digitalizado. Peça à contabilidade o arquivo original.',
        );
      }
      return texto;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao ler o PDF ${arquivo.originalname}: ${motivo}`);
      throw new BadRequestException(`Não consegui abrir este PDF: ${motivo}`);
    }
  }

  /**
   * Grava o que a pessoa confirmou na tela. Vem do corpo da requisição, e não
   * de uma releitura do arquivo, justamente porque ela pode ter corrigido a
   * classificação de um item que o leitor não conhecia.
   */
  async gravar(dto: GravarGuiaDto, usuarioId?: string) {
    const soma = dto.itens.reduce((s, i) => s + i.valor, 0);
    if (Math.abs(soma - dto.valorTotal) >= 0.01) {
      throw new BadRequestException(
        `A soma dos itens (${soma.toFixed(2)}) não bate com o total da guia (${dto.valorTotal.toFixed(2)}).`,
      );
    }

    try {
      return await this.prisma.guia.create({
        data: {
          tipo: dto.tipo as TipoGuia,
          competencia: dto.competencia,
          vencimento: new Date(dto.vencimento),
          valorTotal: new Prisma.Decimal(dto.valorTotal),
          numeroDocumento: dto.numeroDocumento || null,
          cnpj: dto.cnpj || null,
          razaoSocial: dto.razaoSocial || null,
          trabalhadores: dto.trabalhadores ?? null,
          arquivoNome: dto.arquivoNome,
          textoOriginal: dto.textoOriginal || null,
          criadoPor: usuarioId ?? null,
          itens: {
            create: dto.itens.map((i) => ({
              codigo: i.codigo || null,
              denominacao: i.denominacao,
              valor: new Prisma.Decimal(i.valor),
              classe: i.classe as ClasseTributo,
            })),
          },
        },
        include: { itens: true },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Esta guia já foi lançada. Apague a anterior se quiser substituir.',
        );
      }
      throw err;
    }
  }

  listar(competencia?: string) {
    return this.prisma.guia.findMany({
      where: competencia ? { competencia } : undefined,
      orderBy: [{ competencia: 'desc' }, { vencimento: 'desc' }],
      take: 200,
      include: { itens: true },
    });
  }

  async remover(id: string) {
    const guia = await this.prisma.guia.findUnique({ where: { id } });
    if (!guia) throw new NotFoundException('Guia não encontrada');
    await this.prisma.guia.delete({ where: { id } });
  }

  /**
   * Quanto cada classe pesou em cada mês. É o que separa "o que a empresa
   * gastou com gente" do que só passou pela conta dela.
   */
  async resumo(meses: string[]): Promise<ResumoImpostos> {
    const guias = await this.prisma.guia.findMany({
      where: { competencia: { in: meses } },
      include: { itens: true },
    });

    const porMes = new Map<string, PorClasse>();
    for (const mes of meses) porMes.set(mes, zerado());

    for (const guia of guias) {
      const alvo = porMes.get(guia.competencia);
      if (!alvo) continue;
      for (const item of guia.itens) {
        alvo[CHAVE_DA_CLASSE[item.classe]] += Number(item.valor);
      }
    }

    const serie = meses.map((competencia) => ({
      competencia,
      ...arredondarClasses(porMes.get(competencia) ?? zerado()),
    }));

    return {
      serie,
      total: arredondarClasses(
        serie.reduce(
          (soma, m) => ({
            folhaPatronal: soma.folhaPatronal + m.folhaPatronal,
            folhaRetido: soma.folhaRetido + m.folhaRetido,
            faturamento: soma.faturamento + m.faturamento,
          }),
          zerado(),
        ),
      ),
      guias: guias.map((g) => ({
        id: g.id,
        tipo: g.tipo,
        competencia: g.competencia,
        vencimento: g.vencimento,
        valorTotal: Number(g.valorTotal),
        trabalhadores: g.trabalhadores,
      })),
    };
  }
}

interface PorClasse {
  folhaPatronal: number;
  folhaRetido: number;
  faturamento: number;
}

export interface ResumoImpostos {
  serie: Array<{ competencia: string } & PorClasse>;
  total: PorClasse;
  guias: Array<{
    id: string;
    tipo: TipoGuia;
    competencia: string;
    vencimento: Date;
    valorTotal: number;
    trabalhadores: number | null;
  }>;
}

const CHAVE_DA_CLASSE: Record<ClasseTributo, keyof PorClasse> = {
  FOLHA_PATRONAL: 'folhaPatronal',
  FOLHA_RETIDO: 'folhaRetido',
  FATURAMENTO: 'faturamento',
};

function zerado(): PorClasse {
  return { folhaPatronal: 0, folhaRetido: 0, faturamento: 0 };
}

function arredondarClasses(p: PorClasse): PorClasse {
  return {
    folhaPatronal: arredondar(p.folhaPatronal),
    folhaRetido: arredondar(p.folhaRetido),
    faturamento: arredondar(p.faturamento),
  };
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
