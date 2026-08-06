import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SentidoVale, Vale, ValeParcela } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CriarValeDto } from './dto/criar-vale.dto';
import { QueryValesDto } from './dto/query-vales.dto';
import { UpdateValeDto } from './dto/update-vale.dto';
import { montarParcelas } from './vales.calc';

/** Vale com o que a tela precisa saber: saldo, andamento e próxima parcela. */
export interface ValeComSaldo {
  vale: Vale & { parcelas: ValeParcela[] };
  funcionarioNome: string;
  saldo: number;
  totalDescontado: number;
  parcelasDescontadas: number;
  quitado: boolean;
  proximaParcela: ValeParcela | null;
}

/** Quanto os vales/acertos mexem no salário de alguém numa competência. */
export interface AcertoValeCompetencia {
  /** O funcionário devia: sai do salário. */
  desconto: number;
  /** A empresa devia: entra no salário. */
  credito: number;
  parcelas: {
    valeId: string;
    sentido: SentidoVale;
    descricao: string;
    numero: number;
    de: number;
    valor: number;
    descontada: boolean;
  }[];
}

@Injectable()
export class ValesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(q: QueryValesDto): Promise<ValeComSaldo[]> {
    const situacao = q.situacao ?? 'TODOS';
    const where: Prisma.ValeWhereInput = {};
    const and: Prisma.ValeWhereInput[] = [];

    if (q.funcionarioId) where.funcionarioId = q.funcionarioId;
    if (q.sentido) where.sentido = q.sentido;
    if (q.busca) {
      where.OR = [
        { descricao: { contains: q.busca, mode: 'insensitive' } },
        { funcionario: { nome: { contains: q.busca, mode: 'insensitive' } } },
      ];
    }
    if (q.competencia) {
      and.push({ parcelas: { some: { competencia: q.competencia } } });
    }
    if (situacao === 'CANCELADO') {
      where.cancelado = true;
    } else if (situacao !== 'TODOS') {
      where.cancelado = false;
      and.push(
        situacao === 'ABERTO'
          ? { parcelas: { some: { descontada: false } } }
          : { parcelas: { every: { descontada: true } } },
      );
    }
    if (and.length > 0) where.AND = and;

    const vales = await this.prisma.vale.findMany({
      where,
      include: {
        parcelas: { orderBy: { numero: 'asc' } },
        funcionario: { select: { nome: true } },
      },
      orderBy: [{ cancelado: 'asc' }, { data: 'desc' }],
    });

    return vales.map(({ funcionario, ...vale }) =>
      comSaldo(vale, funcionario.nome),
    );
  }

  async buscar(id: string): Promise<ValeComSaldo> {
    const vale = await this.prisma.vale.findUnique({
      where: { id },
      include: {
        parcelas: { orderBy: { numero: 'asc' } },
        funcionario: { select: { nome: true } },
      },
    });
    if (!vale) throw new NotFoundException('Vale não encontrado');
    const { funcionario, ...resto } = vale;
    return comSaldo(resto, funcionario.nome);
  }

  async criar(dto: CriarValeDto): Promise<ValeComSaldo> {
    const funcionario = await this.prisma.funcionario.findUnique({
      where: { id: dto.funcionarioId },
      select: { id: true },
    });
    if (!funcionario) throw new NotFoundException('Funcionário não encontrado');
    if (!dto.valorTotal && !dto.valorParcela) {
      throw new BadRequestException(
        'Informe o valor total do vale ou o valor de cada parcela',
      );
    }

    const calculado = montarParcelas({
      valorTotal: dto.valorTotal,
      valorParcela: dto.valorParcela,
      quantidadeParcelas: dto.quantidadeParcelas,
      competenciaInicio: dto.competenciaInicio,
    });

    const criado = await this.prisma.vale.create({
      data: {
        funcionarioId: dto.funcionarioId,
        sentido: dto.sentido ?? SentidoVale.DESCONTO,
        descricao: dto.descricao,
        data: dto.data ? new Date(dto.data) : new Date(),
        valorTotal: new Prisma.Decimal(calculado.valorTotal),
        quantidadeParcelas: dto.quantidadeParcelas,
        valorParcela: new Prisma.Decimal(calculado.valorParcela),
        descontarDaFolha: dto.descontarDaFolha ?? true,
        competenciaInicio: dto.competenciaInicio,
        observacao: dto.observacao ?? null,
        parcelas: {
          create: calculado.parcelas.map((p) => ({
            numero: p.numero,
            competencia: p.competencia,
            valor: new Prisma.Decimal(p.valor),
          })),
        },
      },
    });

    return this.buscar(criado.id);
  }

  async atualizar(id: string, dto: UpdateValeDto): Promise<ValeComSaldo> {
    await this.assertExiste(id);
    await this.prisma.vale.update({
      where: { id },
      data: {
        descricao: dto.descricao,
        descontarDaFolha: dto.descontarDaFolha,
        cancelado: dto.cancelado,
        observacao: dto.observacao,
      },
    });
    return this.buscar(id);
  }

  /** Marca/desmarca uma parcela na mão (quitação fora da folha, correção). */
  async marcarParcela(
    parcelaId: string,
    descontada: boolean,
  ): Promise<ValeComSaldo> {
    const parcela = await this.prisma.valeParcela.findUnique({
      where: { id: parcelaId },
      select: { valeId: true },
    });
    if (!parcela) throw new NotFoundException('Parcela não encontrada');
    await this.prisma.valeParcela.update({
      where: { id: parcelaId },
      data: { descontada, descontadaEm: descontada ? new Date() : null },
    });
    return this.buscar(parcela.valeId);
  }

  /** Só apaga vale que ainda não mexeu em folha nenhuma. */
  async remover(id: string): Promise<void> {
    await this.assertExiste(id);
    const descontadas = await this.prisma.valeParcela.count({
      where: { valeId: id, descontada: true },
    });
    if (descontadas > 0) {
      throw new BadRequestException(
        'Este vale já teve parcela descontada em folha; cancele em vez de excluir',
      );
    }
    await this.prisma.vale.delete({ where: { id } });
  }

  // -------------------------------------------------------------------------
  // Integração com a folha
  // -------------------------------------------------------------------------

  /**
   * Parcelas que caem na folha desta competência, por funcionário, separadas
   * pelo sentido: o que o funcionário deve sai do salário, o que a empresa
   * deve entra. Vale cancelado ou marcado para não descontar fica de fora.
   */
  async acertosDaCompetencia(
    competencia: string,
    funcionarioIds?: string[],
  ): Promise<Map<string, AcertoValeCompetencia>> {
    if (funcionarioIds && funcionarioIds.length === 0) return new Map();

    const parcelas = await this.prisma.valeParcela.findMany({
      where: {
        competencia,
        vale: {
          descontarDaFolha: true,
          cancelado: false,
          ...(funcionarioIds ? { funcionarioId: { in: funcionarioIds } } : {}),
        },
      },
      include: {
        vale: {
          select: {
            id: true,
            funcionarioId: true,
            sentido: true,
            descricao: true,
            quantidadeParcelas: true,
          },
        },
      },
      orderBy: { numero: 'asc' },
    });

    const mapa = new Map<string, AcertoValeCompetencia>();
    for (const p of parcelas) {
      const atual = mapa.get(p.vale.funcionarioId) ?? {
        desconto: 0,
        credito: 0,
        parcelas: [],
      };
      const valor = Number(p.valor);
      if (p.vale.sentido === SentidoVale.CREDITO) {
        atual.credito = arredondar(atual.credito + valor);
      } else {
        atual.desconto = arredondar(atual.desconto + valor);
      }
      atual.parcelas.push({
        valeId: p.vale.id,
        sentido: p.vale.sentido,
        descricao: p.vale.descricao,
        numero: p.numero,
        de: p.vale.quantidadeParcelas,
        valor,
        descontada: p.descontada,
      });
      mapa.set(p.vale.funcionarioId, atual);
    }
    return mapa;
  }

  /** Fecha as parcelas da competência (dos dois sentidos) quando a folha sai. */
  async marcarDescontadas(
    competencia: string,
    funcionarioIds: string[],
  ): Promise<number> {
    if (funcionarioIds.length === 0) return 0;
    const { count } = await this.prisma.valeParcela.updateMany({
      where: {
        competencia,
        descontada: false,
        vale: {
          descontarDaFolha: true,
          cancelado: false,
          funcionarioId: { in: funcionarioIds },
        },
      },
      data: { descontada: true, descontadaEm: new Date() },
    });
    return count;
  }

  /** Números do dashboard. */
  async resumo(competencia: string) {
    const emAberto: Prisma.ValeWhereInput = {
      cancelado: false,
      parcelas: { some: { descontada: false } },
    };
    const naCompetencia = (sentido: SentidoVale): Prisma.ValeParcelaWhereInput => ({
      competencia,
      vale: { cancelado: false, descontarDaFolha: true, sentido },
    });
    const [vales, aDescontar, aPagar, descontoMes, creditoMes] =
      await this.prisma.$transaction([
        this.prisma.vale.count({ where: emAberto }),
        this.prisma.valeParcela.aggregate({
          where: {
            descontada: false,
            vale: { cancelado: false, sentido: SentidoVale.DESCONTO },
          },
          _sum: { valor: true },
        }),
        this.prisma.valeParcela.aggregate({
          where: {
            descontada: false,
            vale: { cancelado: false, sentido: SentidoVale.CREDITO },
          },
          _sum: { valor: true },
        }),
        this.prisma.valeParcela.aggregate({
          where: naCompetencia(SentidoVale.DESCONTO),
          _sum: { valor: true },
        }),
        this.prisma.valeParcela.aggregate({
          where: naCompetencia(SentidoVale.CREDITO),
          _sum: { valor: true },
        }),
      ]);

    return {
      valesEmAberto: vales,
      /** O que os funcionários ainda devem à empresa */
      saldoDevedor: Number(aDescontar._sum.valor ?? 0),
      /** O que a empresa ainda deve aos funcionários */
      saldoAPagar: Number(aPagar._sum.valor ?? 0),
      descontoNaCompetencia: Number(descontoMes._sum.valor ?? 0),
      creditoNaCompetencia: Number(creditoMes._sum.valor ?? 0),
    };
  }

  private async assertExiste(id: string) {
    const existe = await this.prisma.vale.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Vale não encontrado');
  }
}

function comSaldo(
  vale: Vale & { parcelas: ValeParcela[] },
  funcionarioNome: string,
): ValeComSaldo {
  const descontadas = vale.parcelas.filter((p) => p.descontada);
  const abertas = vale.parcelas.filter((p) => !p.descontada);
  return {
    vale,
    funcionarioNome,
    saldo: arredondar(abertas.reduce((s, p) => s + Number(p.valor), 0)),
    totalDescontado: arredondar(
      descontadas.reduce((s, p) => s + Number(p.valor), 0),
    ),
    parcelasDescontadas: descontadas.length,
    quitado: abertas.length === 0,
    proximaParcela: abertas[0] ?? null,
  };
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
