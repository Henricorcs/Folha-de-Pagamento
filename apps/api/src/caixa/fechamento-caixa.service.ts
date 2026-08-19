import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DespesasService } from '../contas-abertas/despesas.service';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { CaixaService, type LancamentoDoCaixa } from '../ixc/caixa.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A despesa que a prestação de contas lança: o que a pessoa foi comprar com o
 * dinheiro que levou.
 *
 * Sem ela o gasto fica sabido só aqui — a nota existe na gaveta e o financeiro
 * da empresa nunca soube que aquele dinheiro virou despesa.
 */
export interface DespesaDaPrestacao {
  /** Quem recebeu, entre os fornecedores que já existem no IXC. */
  idFornecedorIxc: number;
  fornecedorNome: string;
  /** O que foi comprado — vira a observação do título no IXC. */
  descricao: string;
  /**
   * Dia em que o dinheiro saiu (AAAA-MM-DD). Vazio = o dia da entrega.
   *
   * Quase sempre está no passado: quem levou dinheiro na segunda só senta para
   * prestar contas na sexta, e a saída no IXC tem de cair na segunda, ou o
   * caixa daquela semana não bate.
   */
  pagoEm?: string;
  categoriaId?: string | null;
  tipoPagamento?: string;
  contaContabil?: number;
}

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
    private readonly despesas: DespesasService,
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

    /*
     * De onde vem o saldo inicial.
     *
     * O webservice do IXC não devolve saldo de conta — o cadastro tem
     * `saldo_abertura`, do dia em que a conta nasceu, e mais nada. Somar a
     * história inteira a cada abertura de tela é a leitura que já derrubou esta
     * página com 502. Então o saldo se encadeia: cada fechamento guarda com
     * quanto o período fechou, e o seguinte começa dali. O primeiro de cada
     * caixa pergunta a quem está contando a gaveta.
     *
     * Quando o fechamento anterior foi contado, é a contagem que vale, e não a
     * conta. Dinheiro que existe na gaveta e não aparece na soma continuaria a
     * faltar em todos os períodos seguintes se o encadeamento seguisse o
     * calculado — a diferença tem de morrer no fechamento em que apareceu.
     */
    const anterior = await this.prisma.fechamentoCaixa.findFirst({
      where: { caixaId, ate: { lt: inicio } },
      orderBy: { ate: 'desc' },
    });
    const saldoInicial = anterior ? Number(saldoQueSegue(anterior)) : null;

    /*
     * Até onde este caixa já está conferido, seja qual for o recorte na tela.
     *
     * Sem isto, "não achei o anterior" tem duas causas e uma frase só: o caixa
     * nunca foi fechado, ou o período pedido **começa dentro** de um que já foi
     * — 04/07 a 18/08 já assinado, e alguém pede de 01/08. A segunda é a comum
     * (o mês corrente é o recorte que a tela abre sozinha) e a mais cara: a
     * tela pedia o saldo inicial como se fosse o primeiro fechamento, e fechar
     * assim contaria de novo dezoito dias de saídas já conferidas.
     */
    const ultimo = await this.prisma.fechamentoCaixa.findFirst({
      where: { caixaId },
      orderBy: [{ ate: 'desc' }, { createdAt: 'desc' }],
      select: { ate: true },
    });
    const fechadoAte = ultimo ? diaISO(ultimo.ate) : null;

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
          { gastoPagoEm: { gte: inicio, lte: fim } },
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

    /*
     * O gasto que a prestação lançou como conta a pagar volta para a conta.
     *
     * Não porque o dinheiro voltou — ele foi gasto —, mas porque ele já saiu
     * uma vez aqui, na entrega, e a conta a pagar baixada no caixa o faz sair
     * de novo pelas saídas do IXC. Descontar os dois tiraria da gaveta o dobro
     * do que a pessoa levou.
     *
     * A data que manda é a da baixa no IXC, e não a da prestação: é ela que
     * decide em que período a saída aparece lá, e quem presta contas costuma
     * fazê-lo dias depois de o dinheiro ter saído.
     */
    const gastoLancadoNoPeriodo = arredondar(
      doPeriodo
        .filter(
          (d) => d.gastoPagoEm && d.gastoPagoEm >= inicio && d.gastoPagoEm <= fim,
        )
        .reduce((s, d) => s + Number(d.valorGasto ?? 0), 0),
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
        /** Null = não há de onde partir; `fechadoAte` diz por qual dos dois motivos. */
        saldoInicial,
        /**
         * Até que dia este caixa já está conferido (AAAA-MM-DD), ou null se
         * nunca foi fechado. Com `saldoInicial` nulo e este preenchido, o
         * período pedido invade um fechamento que já existe.
         */
        fechadoAte,
        entregueNoPeriodo,
        trocoNoPeriodo,
        /** O que as saídas do IXC já descontam por conta da prestação. */
        gastoLancadoNoPeriodo,
        /** O que deve estar na gaveta agora. Null enquanto falta o inicial. */
        saldoEsperado:
          saldoInicial === null
            ? null
            : arredondar(
                saldoInicial +
                  soma('ENTRADA') -
                  soma('SAIDA') -
                  entregueNoPeriodo +
                  trocoNoPeriodo +
                  gastoLancadoNoPeriodo,
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
   *
   * Vindo a despesa junto, o gasto vira conta a pagar no IXC: criada, aprovada
   * e baixada no caixa de onde o dinheiro saiu, na data em que saiu. É o que
   * transforma a nota que a pessoa trouxe numa saída de verdade — antes disto
   * o dinheiro sumia da gaveta sem virar despesa em lugar nenhum.
   */
  async baixar(
    id: string,
    dados: {
      valorGasto: number;
      troco?: number;
      notaFoto?: string | null;
      observacao?: string;
      /** A conta a pagar a lançar pelo que foi gasto. */
      despesa?: DespesaDaPrestacao;
    },
    usuarioId?: string,
    usuarioNome?: string,
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
    if (dados.despesa && dados.valorGasto <= 0) {
      throw new BadRequestException(
        'Não há despesa a lançar: o dinheiro voltou inteiro como troco.',
      );
    }

    /*
     * A despesa vai antes da baixa, de propósito.
     *
     * Não dando para lançá-la, a entrega continua aberta e quem está prestando
     * contas tenta de novo com tudo ainda na tela. Na ordem inversa, uma falha
     * do IXC deixaria a entrega fechada aqui e a despesa em lugar nenhum — e
     * entrega fechada não presta contas de novo.
     */
    const lancada = dados.despesa
      ? await this.lancarADespesa(atual, dados.valorGasto, dados.despesa, {
          usuarioId,
          usuarioNome,
        })
      : null;

    const salvo = await this.prisma.dinheiroNaRua.update({
      where: { id },
      data: {
        baixadoEm: new Date(),
        baixadoPor: usuarioId ?? null,
        valorGasto: new Prisma.Decimal(dados.valorGasto),
        troco: new Prisma.Decimal(troco),
        ...(dados.notaFoto === undefined ? {} : { notaFoto: dados.notaFoto }),
        observacao: dados.observacao?.trim() || null,
        ...(lancada
          ? {
              idFnApagarIxc: lancada.idFnApagarIxc,
              contaPagarId: lancada.contaPagarId,
              fornecedorNome: lancada.fornecedorNome,
              gastoPagoEm: lancada.pagoEm,
            }
          : {}),
      },
    });
    this.logger.log(
      `Prestação de contas de ${salvo.pessoa}: ${dados.valorGasto} em nota, ` +
        `${troco} de troco` +
        (lancada ? `, título #${lancada.idFnApagarIxc ?? '?'} no IXC` : ''),
    );
    return { ...semFoto(salvo), despesa: lancada };
  }

  /**
   * Lança o gasto como conta a pagar, quitada no caixa de onde o dinheiro saiu.
   *
   * O caixa é o da entrega, e não o padrão da configuração: o dinheiro saiu
   * daquela gaveta, e é dela que a saída tem de sair no IXC.
   *
   * `pagoEm` só volta preenchido quando o IXC deu a conta por paga. É esta data
   * que faz o saldo somar o gasto de volta, para o mesmo dinheiro não ser
   * descontado duas vezes — uma pela entrega, outra pela saída lá. Título
   * criado que não chegou a ser baixado não gera saída nenhuma, e portanto não
   * pode gerar compensação: o aviso volta para a tela e a conta se paga pela
   * lista de contas em aberto.
   */
  private async lancarADespesa(
    entrega: { caixaId: number; entregueEm: Date; pessoa: string },
    valorGasto: number,
    despesa: DespesaDaPrestacao,
    quem: { usuarioId?: string; usuarioNome?: string },
  ) {
    const dia = despesa.pagoEm?.trim() || diaISO(entrega.entregueEm);
    const fornecedorNome = despesa.fornecedorNome.trim();

    const lancamento = await this.despesas.lancar(
      {
        idFornecedorIxc: despesa.idFornecedorIxc,
        fornecedorNome,
        valor: valorGasto,
        // As três datas são o mesmo dia: a conta não tem vencimento futuro a
        // esperar, ela nasce quitada com a data em que o dinheiro saiu.
        dataEmissao: dia,
        dataVencimento: dia,
        dataPagamento: dia,
        observacao: despesa.descricao.trim(),
        categoriaId: despesa.categoriaId ?? null,
        tipoPagamento: despesa.tipoPagamento,
        contaContabil: despesa.contaContabil,
        contaPagamento: entrega.caixaId,
        jaPaga: true,
      },
      quem.usuarioId,
      quem.usuarioNome,
    );

    const paga = (lancamento.baixa?.pagas ?? 0) > 0;
    const avisos = [
      ...(lancamento.baixa?.avisos ?? []),
      ...(lancamento.avisoCategoria ? [lancamento.avisoCategoria] : []),
    ];
    if (!paga) {
      this.logger.warn(
        `Despesa de ${entrega.pessoa} lançada, mas não ficou paga no IXC: ` +
          (avisos.join(' ') || 'sem detalhe'),
      );
    }

    return {
      contaPagarId: lancamento.conta.id,
      idFnApagarIxc: lancamento.conta.idFnApagarIxc,
      fornecedorNome,
      /** Null quando a baixa não saiu — sem saída no IXC, sem compensação. */
      pagoEm: paga ? dataDoDia(dia, 'do pagamento') : null,
      paga,
      valor: valorGasto,
      avisos,
    };
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
      /** Quanto se contou na gaveta ao fechar, quando se contou. */
      saldoContado?: number;
    },
    usuarioId?: string,
  ) {
    const extrato = await this.extrato(dados.caixaId, dados.de, dados.ate);

    /*
     * Período que começa dentro de outro já fechado é recusado.
     *
     * As saídas daqueles dias já foram conferidas e já entraram num saldo
     * assinado; contá-las de novo somaria as mesmas duas vezes, e o segundo
     * fechamento passaria a disputar com o primeiro o posto de "anterior" do
     * seguinte. Barrar aqui, e não só avisar na tela, porque o estrago é
     * silencioso: os números saem plausíveis e errados.
     */
    if (extrato.resumo.fechadoAte && dados.de <= extrato.resumo.fechadoAte) {
      throw new BadRequestException(
        `Este caixa já está fechado até ${formatarDia(extrato.resumo.fechadoAte)}. ` +
          `Comece o período em ${formatarDia(diaSeguinte(extrato.resumo.fechadoAte))} — ` +
          'recontar dias já conferidos somaria as mesmas saídas duas vezes.',
      );
    }

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
        extrato.resumo.trocoNoPeriodo +
        extrato.resumo.gastoLancadoNoPeriodo,
    );

    if (dados.saldoContado !== undefined && dados.saldoContado < 0) {
      throw new BadRequestException('A gaveta não conta valor negativo.');
    }
    const saldoContado =
      dados.saldoContado === undefined
        ? null
        : arredondar(dados.saldoContado);

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
        saldoContado:
          saldoContado === null ? null : new Prisma.Decimal(saldoContado),
        observacao: dados.observacao?.trim() || null,
        fechadoPor: usuarioId ?? null,
      },
    });
    this.logger.log(
      `Caixa "${extrato.caixa.nome}" fechado de ${dados.de} a ${dados.ate}: ` +
        `${extrato.resumo.saidasConferidas} saída(s) conferida(s), ` +
        `saldo de ${saldoFinal}` +
        (saldoContado === null ? '' : ` (contados ${saldoContado})`) +
        `, ${extrato.resumo.naRua} ainda na rua`,
    );
    return fechamento;
  }

  /**
   * Corrige o que se contou na gaveta num fechamento já assinado.
   *
   * Só o último de cada caixa aceita correção. Os totais de um fechamento são
   * uma cópia do que se viu no dia, de propósito — mexer num do meio deixaria
   * os seguintes apoiados num saldo que não existe mais, sem nada na tela
   * denunciando. O último não tem ninguém apoiado nele: é o próximo período,
   * que ainda não fechou, que vai ler este número.
   */
  async corrigirContagem(id: string, saldoContado: number, usuarioId?: string) {
    if (saldoContado < 0) {
      throw new BadRequestException('A gaveta não conta valor negativo.');
    }

    const fechamento = await this.prisma.fechamentoCaixa.findUnique({
      where: { id },
    });
    if (!fechamento) {
      throw new BadRequestException('Este fechamento não existe.');
    }

    const ultimo = await this.prisma.fechamentoCaixa.findFirst({
      where: { caixaId: fechamento.caixaId },
      orderBy: [{ ate: 'desc' }, { createdAt: 'desc' }],
    });
    if (ultimo && ultimo.id !== id) {
      throw new BadRequestException(
        'Este caixa já foi fechado de novo depois deste período. Corrigir a ' +
          'contagem aqui mudaria o ponto de partida de fechamentos que já ' +
          'foram assinados — a correção se faz no último.',
      );
    }

    const salvo = await this.prisma.fechamentoCaixa.update({
      where: { id },
      data: { saldoContado: new Prisma.Decimal(arredondar(saldoContado)) },
    });
    const diferenca = arredondar(
      Number(salvo.saldoContado) - Number(salvo.saldoFinal),
    );
    this.logger.log(
      `Contagem do fechamento ${id} corrigida para ${saldoContado} ` +
        `(calculado: ${Number(salvo.saldoFinal)}, diferença de ${diferenca})` +
        (usuarioId ? ` por ${usuarioId}` : ''),
    );
    return salvo;
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
 * De quanto o período seguinte parte: a contagem, quando houve, senão a conta.
 *
 * Contar a gaveta é o único jeito de a soma encontrar a realidade. Onde os dois
 * discordam, quem tem razão é o dinheiro que dá para pegar na mão.
 */
function saldoQueSegue(f: {
  saldoFinal: Prisma.Decimal;
  saldoContado: Prisma.Decimal | null;
}): Prisma.Decimal {
  return f.saldoContado ?? f.saldoFinal;
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

/** "AAAA-MM-DD" para o dia seguinte, também em "AAAA-MM-DD". */
function diaSeguinte(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  return diaISO(new Date(a, m - 1, d + 1));
}

/** "AAAA-MM-DD" para "DD/MM/AAAA", que é como a frase de erro o mostra. */
function formatarDia(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/** Date para "AAAA-MM-DD", no fuso de quem está batendo o caixa. */
function diaISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatar(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
