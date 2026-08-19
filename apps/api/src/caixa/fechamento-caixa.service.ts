import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, TipoMovimentoDaRua } from '@prisma/client';
import { DespesasService } from '../contas-abertas/despesas.service';
import { PagamentosService } from '../contas-abertas/pagamentos.service';
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
    private readonly pagamentos: PagamentosService,
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
    /*
     * O período vai até o fim do último dia, e não até a meia-noite dele.
     *
     * `dataDoDia` devolve 00:00, que é o **começo** do dia. Usar isso como fim
     * fazia o recorte de hoje ser o intervalo vazio [00:00, 00:00]: uma saída
     * anotada às duas da tarde ficava de fora, e a gaveta não se mexia com ela
     * — o dinheiro tinha saído e a tela dizia que não. Só o que nasce com hora
     * zerada (os fechamentos, os acertos com data escolhida) escapava disso,
     * que é por que o defeito demorou a aparecer.
     */
    const fim = fimDoDia(dataDoDia(ate, 'final'));
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
      include: { movimentos: { orderBy: { data: 'asc' } } },
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
    const entregasDoPeriodo = await this.prisma.dinheiroNaRua.findMany({
      where: { caixaId, entregueEm: { gte: inicio, lte: fim } },
      select: { valor: true },
    });

    /*
     * Os acertos entram pelo dia em que aconteceram, e não pelo dia em que
     * foram digitados: quem leva dinheiro na segunda presta contas na sexta, e
     * a semana em que a gaveta mudou foi a da segunda.
     */
    const movimentosDoPeriodo = await this.prisma.movimentoDaRua.findMany({
      where: {
        entrega: { caixaId },
        OR: [
          { data: { gte: inicio, lte: fim } },
          { gastoPagoEm: { gte: inicio, lte: fim } },
        ],
      },
    });

    const somaDosMovimentos = (
      tipo: TipoMovimentoDaRua,
      quando: (m: (typeof movimentosDoPeriodo)[number]) => Date | null,
    ) =>
      arredondar(
        movimentosDoPeriodo
          .filter((m) => {
            if (m.tipo !== tipo) return false;
            const d = quando(m);
            return !!d && d >= inicio && d <= fim;
          })
          .reduce((s, m) => s + Number(m.valor), 0),
      );

    // O reforço sai da gaveta pelo mesmo motivo que a entrega: é dinheiro indo
    // para a mão de alguém sem passar pelo IXC.
    const entregueNoPeriodo = arredondar(
      entregasDoPeriodo.reduce((s, d) => s + Number(d.valor), 0) +
        somaDosMovimentos('REFORCO', (m) => m.data),
    );
    const trocoNoPeriodo = somaDosMovimentos('TROCO', (m) => m.data);

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
    const gastoLancadoNoPeriodo = somaDosMovimentos(
      'NOTA',
      (m) => m.gastoPagoEm,
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
      naRua: naRua.map(comSaldo),
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
        // O que ainda está com as pessoas — não o que um dia saiu com elas.
        naRua: arredondar(naRua.reduce((s, d) => s + saldoDaConta(d), 0)),
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
    return comSaldo({ ...criado, movimentos: [] });
  }

  /**
   * Um acerto da conta de quem está com dinheiro da empresa.
   *
   * A entrega raramente se resolve de uma vez. A pessoa leva R$ 100,00, traz
   * nota de R$ 50,00 e fica com os outros R$ 50,00 para a próxima compra; às
   * vezes a compra passa do que ela tem na mão e mais dinheiro sai da gaveta
   * para completar. Exigir que nota e troco fechassem a entrega inteira de uma
   * vez — que era a regra antiga — obrigava a mentir num dos dois campos para o
   * botão liberar.
   *
   * Então cada acerto é um lançamento, e o saldo da pessoa anda com eles:
   *
   *  - `NOTA` comprova um gasto e desce o saldo. É esta que vira conta a pagar
   *    no IXC, quando vem com a despesa junto;
   *  - `TROCO` devolve dinheiro para a gaveta e desce o saldo;
   *  - `REFORCO` tira mais dinheiro da gaveta e sobe o saldo.
   *
   * Zerado o saldo, a conta se fecha sozinha.
   */
  async lancarMovimento(
    entregaId: string,
    dados: {
      tipo: TipoMovimentoDaRua;
      valor: number;
      /** Dia em que aconteceu (AAAA-MM-DD). Vazio = hoje. */
      data?: string;
      notaFoto?: string | null;
      observacao?: string;
      /** Só para NOTA: a conta a pagar a lançar pelo que foi gasto. */
      despesa?: DespesaDaPrestacao;
    },
    usuarioId?: string,
    usuarioNome?: string,
  ) {
    const conta = await this.prisma.dinheiroNaRua.findUnique({
      where: { id: entregaId },
      include: { movimentos: true },
    });
    if (!conta) throw new BadRequestException('Esta entrega não existe.');
    if (conta.baixadoEm) {
      throw new BadRequestException(
        'Esta conta já foi acertada — o saldo dela zerou.',
      );
    }

    if (!(dados.valor > 0)) {
      throw new BadRequestException('O valor precisa ser maior que zero.');
    }

    const saldo = saldoDaConta(conta);
    /*
     * Nota ou troco maior que o saldo é sempre engano de digitação, e um caro:
     * ele deixaria a pessoa devendo negativo, e o negativo entraria no total da
     * rua abatendo o saldo de quem realmente está com dinheiro. O reforço é o
     * único que pode passar — ele é dinheiro saindo, não acerto.
     */
    if (dados.tipo !== 'REFORCO' && dados.valor - saldo > 0.005) {
      throw new BadRequestException(
        `${conta.pessoa} está com ${formatar(saldo)}, e este lançamento é de ` +
          `${formatar(dados.valor)}. Se saiu mais dinheiro, registre o reforço ` +
          'antes.',
      );
    }

    if (dados.despesa && dados.tipo !== 'NOTA') {
      throw new BadRequestException(
        'Só a nota vira conta a pagar: troco e reforço não são despesa.',
      );
    }

    const dia = dados.data ? dataDoDia(dados.data, 'do lançamento') : new Date();

    /*
     * A despesa vai antes de gravar o movimento, de propósito.
     *
     * Não dando para lançá-la, nada é gravado e quem está prestando contas
     * tenta de novo com tudo ainda na tela. Na ordem inversa, uma falha do IXC
     * deixaria o saldo abatido aqui e a despesa em lugar nenhum.
     */
    const lancada = dados.despesa
      ? await this.lancarADespesa(conta, dados.valor, dados.despesa, dia, {
          usuarioId,
          usuarioNome,
        })
      : null;

    const movimento = await this.prisma.movimentoDaRua.create({
      data: {
        entregaId,
        tipo: dados.tipo,
        valor: new Prisma.Decimal(arredondar(dados.valor)),
        data: dia,
        observacao: dados.observacao?.trim() || null,
        notaFoto: dados.notaFoto ?? null,
        criadoPor: usuarioId ?? null,
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

    /*
     * Zerou, fecha. O acerto não é um botão à parte: quem acabou de devolver o
     * último real já disse tudo o que havia para dizer, e pedir uma confirmação
     * depois disso só deixaria contas zeradas abertas na tela por esquecimento.
     */
    const novoSaldo = arredondar(
      saldo + (dados.tipo === 'REFORCO' ? dados.valor : -dados.valor),
    );
    const fechou = Math.abs(novoSaldo) < 0.005;
    if (fechou) {
      await this.prisma.dinheiroNaRua.update({
        where: { id: entregaId },
        data: { baixadoEm: new Date(), baixadoPor: usuarioId ?? null },
      });
    }

    this.logger.log(
      `${dados.tipo} de ${dados.valor} na conta de ${conta.pessoa}: ` +
        `saldo ${saldo} -> ${novoSaldo}` +
        (lancada ? `, título #${lancada.idFnApagarIxc ?? '?'} no IXC` : '') +
        (fechou ? ' (conta acertada)' : ''),
    );

    return {
      movimento: semFoto(movimento),
      saldo: novoSaldo,
      acertada: fechou,
      despesa: lancada,
    };
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
    entrega: { caixaId: number; pessoa: string },
    valorGasto: number,
    despesa: DespesaDaPrestacao,
    quando: Date,
    quem: { usuarioId?: string; usuarioNome?: string },
  ) {
    const dia = despesa.pagoEm?.trim() || diaISO(quando);
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

  /** A foto da nota de um lançamento da rua. */
  async notaDoMovimento(id: string) {
    const m = await this.prisma.movimentoDaRua.findUnique({
      where: { id },
      select: { notaFoto: true },
    });
    return { notaFoto: m?.notaFoto ?? null };
  }

  /**
   * Desfaz um lançamento — qualquer um da conta, e não só o último.
   *
   * Quem digita 100 no lugar de 10 percebe depois de já ter lançado o troco, e
   * obrigar a desfazer de trás para frente era só burocracia: o saldo é uma
   * soma, e some qualquer parcela que se tire.
   *
   * O que não dá para desfazer sozinho é o que virou título no IXC. Apagar só
   * deste lado deixaria a saída viva lá — o caixa passaria a descontar um
   * dinheiro que ninguém compensa, e a gaveta apareceria menor do que é. Então
   * o app tenta apagar o título junto; não conseguindo, recusa e diz o número,
   * para o acerto se resolver onde ele existe.
   */
  async desfazerMovimento(id: string) {
    const m = await this.prisma.movimentoDaRua.findUnique({ where: { id } });
    if (!m) throw new BadRequestException('Este lançamento não existe.');

    if (m.idFnApagarIxc) {
      try {
        await this.pagamentos.excluir(m.idFnApagarIxc);
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        throw new BadRequestException(
          `Este lançamento virou a conta a pagar #${m.idFnApagarIxc} no IXC, e ` +
            `ela não pôde ser apagada de lá: ${motivo} Estorne o pagamento ` +
            'dela no IXC (Pagar > Estornar pagamento recebido) e desfaça aqui ' +
            'de novo — senão a saída continua contando lá e a gaveta aparece ' +
            'menor do que está.',
        );
      }
      this.logger.log(
        `Título #${m.idFnApagarIxc} apagado no IXC ao desfazer o lançamento ${id}`,
      );
    }

    await this.prisma.movimentoDaRua.delete({ where: { id } });
    // A conta reabre: ela só estava fechada porque o saldo tinha zerado.
    await this.prisma.dinheiroNaRua.update({
      where: { id: m.entregaId },
      data: { baixadoEm: null, baixadoPor: null },
    });
  }

  /**
   * Desfaz o acerto inteiro: a conta volta a ser só a entrega.
   *
   * É o botão de quem se perdeu no meio e prefere recomeçar a caçar qual das
   * três linhas está errada. Os que não puderem ser desfeitos — os que viraram
   * título pago no IXC — ficam, e voltam nomeados: desfazer pela metade em
   * silêncio seria pior que não desfazer.
   */
  async desfazerAcertos(entregaId: string) {
    const conta = await this.prisma.dinheiroNaRua.findUnique({
      where: { id: entregaId },
      include: { movimentos: { orderBy: { createdAt: 'desc' } } },
    });
    if (!conta) throw new BadRequestException('Esta entrega não existe.');

    const mantidos: string[] = [];
    let desfeitos = 0;
    for (const m of conta.movimentos) {
      try {
        await this.desfazerMovimento(m.id);
        desfeitos += 1;
      } catch (err) {
        mantidos.push(err instanceof Error ? err.message : String(err));
      }
    }

    const atual = await this.prisma.dinheiroNaRua.findUnique({
      where: { id: entregaId },
      include: { movimentos: { orderBy: { data: 'asc' } } },
    });
    return { desfeitos, mantidos, conta: atual ? comSaldo(atual) : null };
  }

  async apagarEntrega(id: string) {
    const atual = await this.prisma.dinheiroNaRua.findUnique({
      where: { id },
      include: { movimentos: { select: { id: true } } },
    });
    if (!atual) throw new BadRequestException('Esta entrega não existe.');
    if (atual.movimentos.length > 0) {
      throw new BadRequestException(
        'Esta conta já tem acerto lançado — apagá-la reescreveria um caixa ' +
          'que já foi conferido. Desfaça os lançamentos primeiro.',
      );
    }
    await this.prisma.dinheiroNaRua.delete({ where: { id } });
  }

  /** O histórico de contas de um caixa, as já acertadas inclusive. */
  async historicoDaRua(caixaId: number) {
    const itens = await this.prisma.dinheiroNaRua.findMany({
      where: { caixaId },
      orderBy: [{ entregueEm: 'desc' }],
      take: 200,
      include: { movimentos: { orderBy: { data: 'asc' } } },
    });
    return itens.map(comSaldo);
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
        // Guardado como o fim do dia, pelo mesmo motivo: um fechamento "até
        // 18/08" termina quando o dia 18 acaba, não quando ele começa.
        ate: fimDoDia(dataDoDia(dados.ate, 'final')),
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

/** Uma conta da rua com o que se precisa saber dela: quanto ainda está fora. */
function comSaldo<
  T extends { movimentos: Array<{ notaFoto?: string | null }> },
>(conta: T) {
  return {
    ...conta,
    saldo: saldoDaConta(conta as never),
    movimentos: conta.movimentos.map(semFoto),
  };
}

/**
 * O que ainda está com a pessoa: a entrega, mais os reforços, menos o que ela
 * já acertou em nota e em troco.
 */
function saldoDaConta(conta: {
  valor: Prisma.Decimal;
  movimentos: Array<{ tipo: TipoMovimentoDaRua; valor: Prisma.Decimal }>;
}): number {
  return arredondar(
    conta.movimentos.reduce(
      (s, m) => s + (m.tipo === 'REFORCO' ? Number(m.valor) : -Number(m.valor)),
      Number(conta.valor),
    ),
  );
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

/** O último instante do dia de uma data. */
function fimDoDia(d: Date): Date {
  const f = new Date(d);
  f.setHours(23, 59, 59, 999);
  return f;
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
