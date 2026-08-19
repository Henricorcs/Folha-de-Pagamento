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
  /**
   * Esta mesma linha já foi conferida na Conciliação bancária.
   *
   * As duas telas leem `fn_movim_finan` da mesma conta, então a mesma saída
   * aparece nas duas. Isto é aviso, não conferência: quem bate a gaveta ainda
   * precisa ver a nota, e é por isso que o `conferido` daqui não muda sozinho
   * por causa da marca de lá. Serve para não olhar duas vezes sem saber.
   */
  conferidoNaConciliacao: boolean;
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

  /** O que a descoberta achou no IXC — a primeira pergunta quando falha. */
  async diagnostico() {
    const cfg = await this.config.obter();
    return this.caixa.diagnostico(cfg);
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

    const ids = lancamentos.map((l) => l.id);
    const [conferencias, naConciliacao] = await Promise.all([
      this.prisma.conferenciaCaixa.findMany({
        where: { caixaId, idLancamentoIxc: { in: ids } },
      }),
      /*
       * O que a Conciliação bancária já conferiu destas mesmas linhas.
       *
       * As duas telas leem `fn_movim_finan` da mesma conta e guardam a marca
       * com a mesma chave — a conta e o id da linha. Só leitura: nada é
       * escrito nem apagado do outro lado.
       */
      this.prisma.conciliacaoLinha.findMany({
        where: { contaIxc: caixaId, idMovimFinan: { in: ids } },
        select: { idMovimFinan: true },
      }),
    ]);
    const porId = new Map(conferencias.map((c) => [c.idLancamentoIxc, c]));
    const conciliadas = new Set(naConciliacao.map((c) => c.idMovimFinan));

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
        conferidoNaConciliacao: conciliadas.has(l.id),
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

    /*
     * De onde vem o saldo inicial.
     *
     * O webservice do IXC não devolve saldo de conta — o cadastro tem
     * `saldo_abertura`, do dia em que a conta nasceu, e mais nada. Somar a
     * história inteira a cada abertura de tela é a leitura que já derrubou esta
     * página com 502. Então o saldo se encadeia: cada fechamento guarda com
     * quanto o período fechou, e o seguinte começa dali. O primeiro de cada
     * caixa pergunta a quem está contando a gaveta.
     */
    const anterior = await this.prisma.fechamentoCaixa.findFirst({
      where: { caixaId, ate: { lt: inicio } },
      orderBy: { ate: 'desc' },
    });
    const saldoInicial = anterior ? Number(anterior.saldoFinal) : null;

    /*
     * O dinheiro na rua mexe na gaveta sem passar pelo IXC.
     *
     * O que sai com alguém sai fisicamente e não vira saída lá; o troco volta
     * do mesmo jeito. Por isso os dois entram nesta conta, e cada um no período
     * em que aconteceu — a entrega pela data em que saiu, o troco pela data da
     * prestação. Sem isso o número na tela não seria o que a pessoa tem na mão.
     */
    const doPeriodo = await this.prisma.dinheiroNaRua.findMany({
      where: {
        caixaId,
        OR: [
          { entregueEm: { gte: inicio, lte: fim } },
          { baixadoEm: { gte: inicio, lte: fim } },
        ],
      },
    });
    const entregueNoPeriodo = arredondar(
      doPeriodo
        .filter((d) => d.entregueEm >= inicio && d.entregueEm <= fim)
        .reduce((s, d) => s + Number(d.valor), 0),
    );
    const trocoNoPeriodo = arredondar(
      doPeriodo
        .filter((d) => d.baixadoEm && d.baixadoEm >= inicio && d.baixadoEm <= fim)
        .reduce((s, d) => s + Number(d.troco ?? 0), 0),
    );

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
        /*
         * A conferência é das saídas.
         *
         * Um caixa de provedor recebe muito mais do que paga — neste, 109
         * recebimentos de cliente para 52 saídas no mesmo mês. Os recebimentos
         * contam no saldo e por isso continuam na lista, mas não é deles que
         * se pede nota nem se confere um a um: o que sai é que precisa de
         * papel. Exigir os 161 para fechar transformaria a conferência em
         * marcação cega, que é o contrário do que ela serve.
         */
        qtdSaidas: comConferencia.filter((l) => l.tipo === 'SAIDA').length,
        saidasConferidas: comConferencia.filter(
          (l) => l.tipo === 'SAIDA' && l.conferido,
        ).length,
        naRua: arredondar(naRua.reduce((s, d) => s + Number(d.valor), 0)),
        pessoasNaRua: new Set(naRua.map((d) => d.pessoa.toLowerCase())).size,
        /** Null = este caixa nunca foi fechado, e ninguém disse por onde começa. */
        saldoInicial,
        entregueNoPeriodo,
        trocoNoPeriodo,
        /** O que deve estar na gaveta agora. Null enquanto falta o inicial. */
        saldoEsperado:
          saldoInicial === null
            ? null
            : arredondar(
                saldoInicial +
                  soma('ENTRADA') -
                  soma('SAIDA') -
                  entregueNoPeriodo +
                  trocoNoPeriodo,
              ),
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
    dados: {
      caixaId: number;
      de: string;
      ate: string;
      observacao?: string;
      /** Só no primeiro fechamento do caixa: de onde a contagem começa. */
      saldoInicial?: number;
    },
    usuarioId?: string,
  ) {
    const extrato = await this.extrato(dados.caixaId, dados.de, dados.ate);
    const faltam = extrato.resumo.qtdSaidas - extrato.resumo.saidasConferidas;
    if (faltam > 0) {
      throw new BadRequestException(
        `Ainda ${
          faltam === 1 ? 'falta 1 saída' : `faltam ${faltam} saídas`
        } por conferir neste período.`,
      );
    }

    /*
     * O primeiro fechamento de um caixa precisa saber de onde a gaveta parte;
     * do segundo em diante, o anterior responde. Recusar aqui, e não assumir
     * zero, porque zero silencioso vira um saldo errado que se propaga por
     * todos os fechamentos seguintes — cada um herdando o erro do anterior.
     */
    const saldoInicial = extrato.resumo.saldoInicial ?? dados.saldoInicial;
    if (saldoInicial === undefined || saldoInicial === null) {
      throw new BadRequestException(
        'Este caixa nunca foi fechado por aqui: informe quanto havia na gaveta ' +
          'no início do período para a contagem ter de onde partir.',
      );
    }

    const saldoFinal = arredondar(
      saldoInicial +
        Number(extrato.resumo.entradas) -
        Number(extrato.resumo.saidas) -
        extrato.resumo.entregueNoPeriodo +
        extrato.resumo.trocoNoPeriodo,
    );

    const fechamento = await this.prisma.fechamentoCaixa.create({
      data: {
        caixaId: dados.caixaId,
        caixaNome: extrato.caixa.nome,
        de: dataDoDia(dados.de, 'inicial'),
        ate: dataDoDia(dados.ate, 'final'),
        totalEntradas: new Prisma.Decimal(extrato.resumo.entradas),
        totalSaidas: new Prisma.Decimal(extrato.resumo.saidas),
        lancamentos: extrato.resumo.qtdSaidas,
        conferidos: extrato.resumo.saidasConferidas,
        totalNaRua: new Prisma.Decimal(extrato.resumo.naRua),
        saldoInicial: new Prisma.Decimal(saldoInicial),
        saldoFinal: new Prisma.Decimal(saldoFinal),
        observacao: dados.observacao?.trim() || null,
        fechadoPor: usuarioId ?? null,
      },
    });
    this.logger.log(
      `Caixa "${extrato.caixa.nome}" fechado de ${dados.de} a ${dados.ate}: ` +
        `${extrato.resumo.saidasConferidas} saída(s) conferida(s), ` +
        `saldo de ${saldoFinal}, ${extrato.resumo.naRua} ainda na rua`,
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
