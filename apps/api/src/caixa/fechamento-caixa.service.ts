import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { CaixaService, type LancamentoDoCaixa } from '../ixc/caixa.service';
import { PrismaService } from '../prisma/prisma.service';

/** Um lançamento do IXC junto do que a conferência guardou sobre ele. */
export interface LancamentoConferido extends LancamentoDoCaixa {
  conferido: boolean;
  conferidoEm: Date | null;
  temNota: boolean;
  observacao: string | null;
}

/**
 * Bater o caixa do dinheiro em mãos.
 *
 * Os lançamentos são do IXC e continuam sendo: esta tela lê e nunca escreve
 * lá. O que nasce aqui é o que o IXC não tem onde guardar — o "já conferi
 * este", a foto da nota, e o dinheiro que saiu com alguém e não voltou.
 *
 * Esse último é o que fazia a conta não fechar no papel. O dinheiro que está
 * com o Jeferson saiu da gaveta e ainda não virou despesa: some da contagem
 * física sem aparecer em lugar nenhum. Enquanto não se declara quem está com
 * quanto, o caixa fecha errado, e por um valor que ninguém sabe explicar
 * depois.
 */
@Injectable()
export class FechamentoCaixaService {
  private readonly logger = new Logger(FechamentoCaixaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly caixa: CaixaService,
    private readonly config: ConfigFinanceiraService,
  ) {}

  /** Os caixas do IXC, para escolher qual bater. */
  async listarCaixas() {
    const cfg = await this.config.obter();
    const { tabela, caixas } = await this.caixa.listarCaixas(
      cfg.caixaTabelaContas,
    );

    let emUso: number | null = null;
    try {
      emUso = await this.caixa.resolverCaixa(cfg);
    } catch {
      // Sem o caixa configurado a tela ainda serve: quem bate escolhe na lista.
      emUso = null;
    }

    return { tabela, caixas, emUso };
  }

  async extrato(caixaId: number, de: string, ate: string) {
    const inicio = dataDoDia(de, 'inicial');
    const fim = dataDoDia(ate, 'final');
    if (inicio > fim) {
      throw new BadRequestException('A data inicial é depois da final.');
    }

    const cfg = await this.config.obter();
    const { caixas } = await this.caixa.listarCaixas(cfg.caixaTabelaContas);
    const oCaixa = caixas.find((c) => c.id === caixaId);

    const { lancamentos } = await this.caixa.listarLancamentos(
      caixaId,
      inicio,
      fim,
      cfg,
    );

    const conferencias = await this.prisma.conferenciaCaixa.findMany({
      where: {
        caixaId,
        idLancamentoIxc: { in: lancamentos.map((l) => l.id) },
      },
    });
    const porId = new Map(conferencias.map((c) => [c.idLancamentoIxc, c]));

    const comConferencia: LancamentoConferido[] = lancamentos.map((l) => {
      const c = porId.get(l.id);
      return {
        ...l,
        conferido: c?.conferido ?? false,
        conferidoEm: c?.conferidoEm ?? null,
        // A foto não vai na listagem: são centenas de KB por linha, e a tela
        // só precisa saber que existe. Quem quer ver pede a dela.
        temNota: !!c?.notaFoto,
        observacao: c?.observacao ?? null,
      };
    });

    // O que está na rua não é do período: é o que está aberto agora. Dinheiro
    // entregue mês passado e ainda não devolvido pesa no fechamento de hoje.
    const naRua = await this.prisma.dinheiroNaRua.findMany({
      where: { caixaId, baixadoEm: null },
      orderBy: { entregueEm: 'asc' },
    });

    const fechamentos = await this.prisma.fechamentoCaixa.findMany({
      where: { caixaId, ate: { gte: inicio }, de: { lte: fim } },
      orderBy: { de: 'desc' },
    });

    const soma = (t: 'ENTRADA' | 'SAIDA') =>
      arredondar(
        comConferencia
          .filter((l) => l.tipo === t)
          .reduce((s, l) => s + l.valor, 0),
      );

    return {
      caixa: { id: caixaId, nome: oCaixa?.nome ?? `Caixa ${caixaId}` },
      de,
      ate,
      lancamentos: comConferencia,
      naRua: naRua.map(semFoto),
      resumo: {
        entradas: soma('ENTRADA'),
        saidas: soma('SAIDA'),
        lancamentos: comConferencia.length,
        conferidos: comConferencia.filter((l) => l.conferido).length,
        naRua: arredondar(naRua.reduce((s, d) => s + Number(d.valor), 0)),
        pessoasNaRua: new Set(naRua.map((d) => d.pessoa.toLowerCase())).size,
      },
      fechamentos,
    };
  }

  /** Marca ou desmarca um lançamento como conferido. */
  async conferir(
    caixaId: number,
    idLancamentoIxc: number,
    dados: { conferido?: boolean; observacao?: string | null },
    usuarioId?: string,
  ) {
    const conferido = dados.conferido ?? true;
    const base = {
      conferido,
      conferidoEm: conferido ? new Date() : null,
      conferidoPor: conferido ? (usuarioId ?? null) : null,
      ...(dados.observacao === undefined
        ? {}
        : { observacao: dados.observacao?.trim() || null }),
    };

    const salvo = await this.prisma.conferenciaCaixa.upsert({
      where: { caixaId_idLancamentoIxc: { caixaId, idLancamentoIxc } },
      create: { caixaId, idLancamentoIxc, ...base },
      update: base,
    });
    return semFoto(salvo);
  }

  /** Guarda (ou tira) a foto da nota de um lançamento. */
  async guardarNota(
    caixaId: number,
    idLancamentoIxc: number,
    notaFoto: string | null,
  ) {
    const salvo = await this.prisma.conferenciaCaixa.upsert({
      where: { caixaId_idLancamentoIxc: { caixaId, idLancamentoIxc } },
      create: { caixaId, idLancamentoIxc, notaFoto },
      update: { notaFoto },
    });
    return semFoto(salvo);
  }

  /** A foto de um lançamento, sob demanda — ela não vai na listagem. */
  async nota(caixaId: number, idLancamentoIxc: number) {
    const c = await this.prisma.conferenciaCaixa.findUnique({
      where: { caixaId_idLancamentoIxc: { caixaId, idLancamentoIxc } },
      select: { notaFoto: true },
    });
    return { notaFoto: c?.notaFoto ?? null };
  }

  // -------------------------------------------------------------------------
  // Dinheiro na rua
  // -------------------------------------------------------------------------

  async entregar(
    dados: {
      caixaId: number;
      pessoa: string;
      valor: number;
      entregueEm?: string;
      motivo?: string;
    },
    usuarioId?: string,
  ) {
    const criado = await this.prisma.dinheiroNaRua.create({
      data: {
        caixaId: dados.caixaId,
        pessoa: dados.pessoa.trim(),
        valor: new Prisma.Decimal(dados.valor),
        entregueEm: dados.entregueEm
          ? dataDoDia(dados.entregueEm, 'da entrega')
          : new Date(),
        motivo: dados.motivo?.trim() || null,
        criadoPor: usuarioId ?? null,
      },
    });
    this.logger.log(
      `Dinheiro na rua: ${dados.valor} com ${criado.pessoa} ` +
        `(caixa #${dados.caixaId})`,
    );
    return semFoto(criado);
  }

  /**
   * A prestação de contas: o que virou despesa e o que voltou de troco.
   *
   * Os dois têm de somar o que saiu. Aceitar uma baixa que não fecha seria
   * transformar o registro em enfeite — ele existe justamente para não deixar
   * a diferença passar sem alguém olhar.
   */
  async baixar(
    id: string,
    dados: {
      valorGasto: number;
      troco?: number;
      notaFoto?: string | null;
      observacao?: string;
    },
    usuarioId?: string,
  ) {
    const atual = await this.prisma.dinheiroNaRua.findUnique({ where: { id } });
    if (!atual) throw new BadRequestException('Esta entrega não existe.');
    if (atual.baixadoEm) {
      throw new BadRequestException('Esta entrega já prestou contas.');
    }

    const troco = dados.troco ?? 0;
    const saiu = Number(atual.valor);
    if (dados.valorGasto < 0 || troco < 0) {
      throw new BadRequestException('Valor negativo não entra na prestação.');
    }
    if (Math.abs(dados.valorGasto + troco - saiu) > 0.005) {
      throw new BadRequestException(
        `A conta não fecha: saíram ${formatar(saiu)} e a prestação soma ` +
          `${formatar(dados.valorGasto + troco)} (${formatar(dados.valorGasto)} ` +
          `de nota + ${formatar(troco)} de troco).`,
      );
    }

    const salvo = await this.prisma.dinheiroNaRua.update({
      where: { id },
      data: {
        baixadoEm: new Date(),
        baixadoPor: usuarioId ?? null,
        valorGasto: new Prisma.Decimal(dados.valorGasto),
        troco: new Prisma.Decimal(troco),
        ...(dados.notaFoto === undefined ? {} : { notaFoto: dados.notaFoto }),
        observacao: dados.observacao?.trim() || null,
      },
    });
    this.logger.log(
      `Prestação de contas de ${salvo.pessoa}: ${dados.valorGasto} em nota, ` +
        `${troco} de troco`,
    );
    return semFoto(salvo);
  }

  /** A foto da nota que a pessoa trouxe. */
  async notaDaRua(id: string) {
    const d = await this.prisma.dinheiroNaRua.findUnique({
      where: { id },
      select: { notaFoto: true },
    });
    return { notaFoto: d?.notaFoto ?? null };
  }

  async apagarEntrega(id: string) {
    const atual = await this.prisma.dinheiroNaRua.findUnique({ where: { id } });
    if (!atual) throw new BadRequestException('Esta entrega não existe.');
    if (atual.baixadoEm) {
      throw new BadRequestException(
        'Esta entrega já prestou contas — apagá-la reescreveria um caixa que ' +
          'já foi conferido.',
      );
    }
    await this.prisma.dinheiroNaRua.delete({ where: { id } });
  }

  /** O histórico de entregas de um caixa, as já baixadas inclusive. */
  async historicoDaRua(caixaId: number) {
    const itens = await this.prisma.dinheiroNaRua.findMany({
      where: { caixaId },
      orderBy: [{ entregueEm: 'desc' }],
      take: 200,
    });
    return itens.map(semFoto);
  }

  // -------------------------------------------------------------------------
  // Fechar
  // -------------------------------------------------------------------------

  /**
   * Dá o período por conferido, guardando os números do momento.
   *
   * Fechar com lançamento por conferir é recusado: o fechamento diz "olhei
   * tudo", e assiná-lo pela metade tira dele o único sentido que tem. Dinheiro
   * na rua, ao contrário, não impede — ele é parte da explicação de por que a
   * gaveta tem menos do que a soma diz, e vai registrado no fechamento.
   */
  async fechar(
    dados: { caixaId: number; de: string; ate: string; observacao?: string },
    usuarioId?: string,
  ) {
    const extrato = await this.extrato(dados.caixaId, dados.de, dados.ate);
    const faltam = extrato.resumo.lancamentos - extrato.resumo.conferidos;
    if (faltam > 0) {
      throw new BadRequestException(
        `Ainda ${
          faltam === 1 ? 'falta 1 lançamento' : `faltam ${faltam} lançamentos`
        } por conferir neste período.`,
      );
    }

    const fechamento = await this.prisma.fechamentoCaixa.create({
      data: {
        caixaId: dados.caixaId,
        caixaNome: extrato.caixa.nome,
        de: dataDoDia(dados.de, 'inicial'),
        ate: dataDoDia(dados.ate, 'final'),
        totalEntradas: new Prisma.Decimal(extrato.resumo.entradas),
        totalSaidas: new Prisma.Decimal(extrato.resumo.saidas),
        lancamentos: extrato.resumo.lancamentos,
        conferidos: extrato.resumo.conferidos,
        totalNaRua: new Prisma.Decimal(extrato.resumo.naRua),
        observacao: dados.observacao?.trim() || null,
        fechadoPor: usuarioId ?? null,
      },
    });
    this.logger.log(
      `Caixa "${extrato.caixa.nome}" fechado de ${dados.de} a ${dados.ate}: ` +
        `${extrato.resumo.conferidos} lançamento(s), ` +
        `${extrato.resumo.naRua} ainda na rua`,
    );
    return fechamento;
  }

  async listarFechamentos(caixaId: number) {
    return this.prisma.fechamentoCaixa.findMany({
      where: { caixaId },
      orderBy: { de: 'desc' },
      take: 50,
    });
  }
}

/**
 * A foto nunca vai numa listagem: são centenas de KB por linha, e uma semana
 * de caixa viraria megabytes de resposta para desenhar uma tabela.
 */
function semFoto<T extends { notaFoto?: string | null }>(registro: T) {
  const { notaFoto, ...resto } = registro;
  return { ...resto, temNota: !!notaFoto };
}

/** "AAAA-MM-DD" para Date, recusando o que não é data. */
function dataDoDia(valor: string, qual: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor).trim());
  if (!m) {
    throw new BadRequestException(
      `A data ${qual} precisa estar no formato AAAA-MM-DD.`,
    );
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`A data ${qual} não existe no calendário.`);
  }
  return d;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatar(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
