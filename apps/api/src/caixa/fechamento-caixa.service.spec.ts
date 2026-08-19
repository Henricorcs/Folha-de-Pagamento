import { BadRequestException } from '@nestjs/common';
import { FechamentoCaixaService } from './fechamento-caixa.service';

/**
 * O que este arquivo protege:
 *
 *  - a prestação de contas fecha ou é recusada: nota + troco têm de somar o
 *    que saiu, senão o registro do dinheiro na rua vira enfeite;
 *  - o fechamento só sai com tudo conferido — assiná-lo pela metade tira dele
 *    o único sentido que tem;
 *  - dinheiro na rua **não** impede fechar: ele é a explicação de por que a
 *    gaveta tem menos, e o fechamento guarda quanto era;
 *  - a contagem da gaveta vence o cálculo, e é dela que o período seguinte
 *    parte — senão a diferença anda de fechamento em fechamento;
 *  - a despesa lançada pela prestação não desconta o dinheiro duas vezes;
 *  - a foto nunca sai numa listagem.
 */

const HOJE = new Date('2026-08-18T12:00:00Z');

/**
 * As duas perguntas que o serviço faz à tabela de fechamentos: o anterior ao
 * período (com recorte de data) e o último do caixa (sem). O `where.ate` é o
 * que as separa.
 */
interface ConsultaDeFechamento {
  where?: { caixaId?: number; ate?: { lt?: Date } };
  orderBy?: unknown;
}

function montarServico(
  opts: {
    lancamentos?: Array<{
      id: number;
      data: Date;
      valor: number;
      historico: string;
      tipo: 'ENTRADA' | 'SAIDA';
    }>;
    conferencias?: Array<{ idLancamentoIxc: number; conferido: boolean; notaFoto?: string }>;
    naRua?: Array<Record<string, unknown>>;
    entrega?: Record<string, unknown> | null;
    /** O fechamento anterior deste caixa, de onde o saldo parte. */
    anterior?: Record<string, unknown> | null;
    /** Entregas e prestações com data dentro do período. */
    movimentoDaRua?: Array<Record<string, unknown>>;
    /** O fechamento que `corrigirContagem` vai buscar pelo id. */
    fechamento?: Record<string, unknown> | null;
    /** O último fechamento do caixa, para a correção saber se pode. */
    ultimo?: Record<string, unknown> | null;
    /** O que o lançamento da despesa devolve. */
    despesaLancada?: Record<string, unknown>;
  } = {},
) {
  const lancamentos = opts.lancamentos ?? [];
  const criados: Record<string, unknown>[] = [];

  const prisma = {
    conferenciaCaixa: {
      findMany: jest.fn().mockResolvedValue(opts.conferencias ?? []),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        id: 'cf1',
        notaFoto: 'data:image/png;base64,AAAA',
        ...create,
      })),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    dinheiroNaRua: {
      // Primeira chamada: o que está aberto. Segunda: o que se mexeu no
      // período, para o saldo da gaveta.
      findMany: jest
        .fn()
        .mockResolvedValueOnce(opts.naRua ?? [])
        .mockResolvedValue(opts.movimentoDaRua ?? []),
      findUnique: jest.fn().mockResolvedValue(opts.entrega ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'r1',
        notaFoto: null,
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'r1',
        pessoa: 'Jeferson',
        notaFoto: 'data:image/png;base64,AAAA',
        ...data,
      })),
      delete: jest.fn(),
    },
    fechamentoCaixa: {
      findMany: jest.fn().mockResolvedValue([]),
      /*
       * Duas perguntas diferentes à mesma tabela: o fechamento anterior ao
       * período (filtrado por data) e o último do caixa (sem filtro). O filtro
       * é o que as distingue.
       */
      findFirst: jest.fn(async (args: Record<string, never> | ConsultaDeFechamento) =>
        (args as ConsultaDeFechamento).where?.ate
          ? (opts.anterior ?? null)
          : (opts.ultimo ?? null),
      ),
      findUnique: jest.fn().mockResolvedValue(opts.fechamento ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        criados.push(data);
        return { id: 'f1', ...data };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'f1',
        saldoFinal: opts.fechamento?.saldoFinal ?? 0,
        ...data,
      })),
    },
  };

  const despesas = {
    lancar: jest.fn().mockResolvedValue(
      opts.despesaLancada ?? {
        conta: { id: 'cp1', idFnApagarIxc: 4242 },
        contas: [{ id: 'cp1', idFnApagarIxc: 4242 }],
        avisoCategoria: null,
        baixa: { pagas: 1, tentadas: 1, valor: 0, data: '2026-08-10', avisos: [] },
      },
    ),
  };

  const caixa = {
    listarCaixas: jest
      .fn()
      .mockResolvedValue({ tabela: 'contas', caixas: [{ id: 7, nome: 'CX - Werick' }] }),
    listarLancamentos: jest.fn().mockResolvedValue({ tabela: 'fn_lancamento_caixa', lancamentos }),
    resolverCaixa: jest.fn().mockResolvedValue(7),
  };

  const config = {
    obter: jest.fn().mockResolvedValue({
      caixaTabelaContas: '',
      caixaTabelaMovimento: '',
      caixaEmMaosNome: 'CX - Werick',
      contaPagamentoCaixaId: 23,
    }),
  };

  const service = new FechamentoCaixaService(
    prisma as never,
    caixa as never,
    config as never,
    despesas as never,
  );
  return { service, prisma, caixa, criados, despesas };
}

const saida = (id: number, valor: number) => ({
  id,
  data: HOJE,
  valor,
  historico: `saída ${id}`,
  tipo: 'SAIDA' as const,
});

describe('extrato do caixa', () => {
  it('junta o lançamento do IXC com o que já foi conferido aqui', async () => {
    const { service } = montarServico({
      lancamentos: [saida(1, 100), saida(2, 250)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.lancamentos).toBe(2);
    expect(e.resumo.conferidos).toBe(1);
    expect(e.resumo.saidas).toBe(350);
    expect(e.lancamentos[0].conferido).toBe(true);
    expect(e.lancamentos[1].conferido).toBe(false);
  });

  it('a foto não vem na listagem, só o aviso de que existe', async () => {
    const { service } = montarServico({
      lancamentos: [saida(1, 100)],
      conferencias: [
        { idLancamentoIxc: 1, conferido: true, notaFoto: 'data:image/png;base64,AAA' },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.lancamentos[0].temNota).toBe(true);
    expect(JSON.stringify(e)).not.toContain('base64');
  });

  it('o que está na rua conta inteiro, mesmo entregue antes do período', async () => {
    const { service, prisma } = montarServico({
      lancamentos: [],
      naRua: [
        { id: 'r1', pessoa: 'Jeferson', valor: 100, entregueEm: new Date('2026-07-02') },
        { id: 'r2', pessoa: 'Letícia', valor: 200, entregueEm: new Date('2026-08-10') },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.naRua).toBe(300);
    expect(e.resumo.pessoasNaRua).toBe(2);
    // A consulta é pelo que está aberto agora, e não pelas datas do período.
    const [{ where }] = prisma.dinheiroNaRua.findMany.mock.calls[0];
    expect(where).toEqual({ caixaId: 7, baixadoEm: null });
  });

  /*
   * "Não achei o anterior" tinha duas causas e uma frase só, e a tela dizia a
   * errada: com 04/07 a 18/08 já assinado, pedir de 01/08 fazia-a anunciar que
   * o caixa nunca fora fechado — e pedir o saldo inicial como se fosse o
   * primeiro de todos.
   */
  it('período que invade um fechamento existente diz até onde está fechado', async () => {
    const { service } = montarServico({
      // Nenhum fechamento terminou antes de 01/08, mas o caixa está conferido
      // até 18/08: o período pedido começa no meio dele.
      anterior: null,
      ultimo: { ate: new Date(2026, 7, 18) },
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-19');

    expect(e.resumo.saldoInicial).toBeNull();
    expect(e.resumo.fechadoAte).toBe('2026-08-18');
  });

  it('caixa virgem não tem até onde: fechadoAte fica nulo', async () => {
    const { service } = montarServico();

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.fechadoAte).toBeNull();
  });

  it('recusa período de trás para frente', async () => {
    const { service } = montarServico();
    await expect(service.extrato(7, '2026-08-31', '2026-08-01')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('prestação de contas de quem levou dinheiro', () => {
  const entrega = { id: 'r1', pessoa: 'Jeferson', valor: 100, baixadoEm: null };

  it('nota mais troco somando o que saiu é aceita', async () => {
    const { service, prisma } = montarServico({ entrega });

    await service.baixar('r1', { valorGasto: 73.5, troco: 26.5 }, 'u1');

    const [{ data }] = prisma.dinheiroNaRua.update.mock.calls[0];
    expect(Number(data.valorGasto)).toBe(73.5);
    expect(Number(data.troco)).toBe(26.5);
    expect(data.baixadoEm).toBeInstanceOf(Date);
  });

  it('gasto sem troco, tendo gasto tudo, também fecha', async () => {
    const { service, prisma } = montarServico({ entrega });

    await service.baixar('r1', { valorGasto: 100 });

    expect(prisma.dinheiroNaRua.update).toHaveBeenCalled();
  });

  it('conta que não fecha é recusada, e diz por quanto', async () => {
    const { service } = montarServico({ entrega });

    await expect(
      service.baixar('r1', { valorGasto: 70, troco: 20 }),
    ).rejects.toThrow(/não fecha/i);
  });

  it('entrega que já prestou contas não presta de novo', async () => {
    const { service } = montarServico({
      entrega: { ...entrega, baixadoEm: new Date('2026-08-15') },
    });

    await expect(service.baixar('r1', { valorGasto: 100 })).rejects.toThrow(
      /já prestou contas/i,
    );
  });

  /*
   * O motivo de a prestação existir: sem a conta a pagar, a nota que a pessoa
   * trouxe fica sabida só aqui, e o caixa do IXC nunca vê aquele dinheiro sair.
   */
  it('a despesa é lançada no caixa da entrega, quitada na data em que saiu', async () => {
    const { service, despesas } = montarServico({
      entrega: {
        ...entrega,
        caixaId: 7,
        entregueEm: new Date(2026, 7, 10),
      },
    });

    await service.baixar(
      'r1',
      {
        valorGasto: 100,
        despesa: {
          idFornecedorIxc: 55,
          fornecedorNome: 'Auto Peças Silva',
          descricao: 'Correia do gerador',
          pagoEm: '2026-08-10',
        },
      },
      'u1',
      'Henrico',
    );

    const [dto] = despesas.lancar.mock.calls[0];
    expect(dto.valor).toBe(100);
    // O dinheiro saiu daquela gaveta: é dela que a saída sai no IXC.
    expect(dto.contaPagamento).toBe(7);
    expect(dto.jaPaga).toBe(true);
    // As três datas são o dia do gasto, e não o dia da prestação.
    expect(dto.dataPagamento).toBe('2026-08-10');
    expect(dto.dataEmissao).toBe('2026-08-10');
    expect(dto.dataVencimento).toBe('2026-08-10');
  });

  it('sem data informada, a despesa cai no dia da entrega', async () => {
    const { service, despesas } = montarServico({
      entrega: { ...entrega, caixaId: 7, entregueEm: new Date(2026, 7, 3) },
    });

    await service.baixar('r1', {
      valorGasto: 100,
      despesa: {
        idFornecedorIxc: 55,
        fornecedorNome: 'Auto Peças Silva',
        descricao: 'Correia do gerador',
      },
    });

    expect(despesas.lancar.mock.calls[0][0].dataPagamento).toBe('2026-08-03');
  });

  it('guarda o título e o dia da saída, que é o que evita o desconto em dobro', async () => {
    const { service, prisma } = montarServico({
      entrega: { ...entrega, caixaId: 7, entregueEm: new Date(2026, 7, 10) },
    });

    await service.baixar('r1', {
      valorGasto: 100,
      despesa: {
        idFornecedorIxc: 55,
        fornecedorNome: 'Auto Peças Silva',
        descricao: 'Correia do gerador',
        pagoEm: '2026-08-10',
      },
    });

    const [{ data }] = prisma.dinheiroNaRua.update.mock.calls[0];
    expect(data.idFnApagarIxc).toBe(4242);
    expect(data.gastoPagoEm).toEqual(new Date(2026, 7, 10));
    expect(data.fornecedorNome).toBe('Auto Peças Silva');
  });

  /*
   * Título criado que não chegou a ser baixado não gera saída no IXC. Marcar o
   * dia mesmo assim faria o saldo somar de volta um dinheiro que ninguém
   * descontou — a gaveta apareceria com mais do que tem.
   */
  it('despesa que não ficou paga no IXC não marca o dia da saída', async () => {
    const { service, prisma } = montarServico({
      entrega: { ...entrega, caixaId: 7, entregueEm: new Date(2026, 7, 10) },
      despesaLancada: {
        conta: { id: 'cp1', idFnApagarIxc: 4242 },
        contas: [{ id: 'cp1', idFnApagarIxc: 4242 }],
        avisoCategoria: null,
        baixa: {
          pagas: 0,
          tentadas: 1,
          valor: 0,
          data: '2026-08-10',
          avisos: ['A conta foi lançada no IXC, mas não ficou paga.'],
        },
      },
    });

    const r = await service.baixar('r1', {
      valorGasto: 100,
      despesa: {
        idFornecedorIxc: 55,
        fornecedorNome: 'Auto Peças Silva',
        descricao: 'Correia do gerador',
        pagoEm: '2026-08-10',
      },
    });

    const [{ data }] = prisma.dinheiroNaRua.update.mock.calls[0];
    expect(data.gastoPagoEm).toBeNull();
    expect(r.despesa?.paga).toBe(false);
    expect(r.despesa?.avisos.length).toBeGreaterThan(0);
  });

  /*
   * A entrega fechada não presta contas de novo. Se a baixa viesse antes da
   * despesa, uma falha do IXC deixaria a entrega quitada aqui e a despesa em
   * lugar nenhum, sem caminho de volta pela tela.
   */
  it('despesa que nem chegou a ser lançada deixa a entrega aberta', async () => {
    const { service, prisma, despesas } = montarServico({
      entrega: { ...entrega, caixaId: 7, entregueEm: new Date(2026, 7, 10) },
    });
    despesas.lancar.mockRejectedValueOnce(new Error('IXC fora do ar'));

    await expect(
      service.baixar('r1', {
        valorGasto: 100,
        despesa: {
          idFornecedorIxc: 55,
          fornecedorNome: 'Auto Peças Silva',
          descricao: 'Correia do gerador',
        },
      }),
    ).rejects.toThrow(/IXC fora do ar/);

    expect(prisma.dinheiroNaRua.update).not.toHaveBeenCalled();
  });

  it('não lança despesa quando o dinheiro voltou inteiro como troco', async () => {
    const { service } = montarServico({
      entrega: { ...entrega, caixaId: 7, entregueEm: new Date(2026, 7, 10) },
    });

    await expect(
      service.baixar('r1', {
        valorGasto: 0,
        troco: 100,
        despesa: {
          idFornecedorIxc: 55,
          fornecedorNome: 'Auto Peças Silva',
          descricao: 'Correia do gerador',
        },
      }),
    ).rejects.toThrow(/voltou inteiro como troco/i);
  });

  it('não apaga entrega já prestada — seria reescrever caixa conferido', async () => {
    const { service } = montarServico({
      entrega: { ...entrega, baixadoEm: new Date('2026-08-15') },
    });

    await expect(service.apagarEntrega('r1')).rejects.toThrow(BadRequestException);
  });
});

describe('o saldo que deve estar na gaveta', () => {
  const DENTRO = new Date(2026, 7, 10);

  it('sem fechamento anterior, não inventa saldo: fica nulo', async () => {
    const { service } = montarServico({ lancamentos: [saida(1, 100)] });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.saldoInicial).toBeNull();
    expect(e.resumo.saldoEsperado).toBeNull();
  });

  /*
   * O anterior tem de ser anterior de verdade. Sem o recorte por data, um
   * período recém-fechado seria lido como o proprio saldo de partida na vez
   * seguinte que a mesma tela abrisse, e o movimento entraria duas vezes.
   */
  it('procura o anterior só entre os que terminaram antes do início', async () => {
    const { service, prisma } = montarServico({ anterior: { saldoFinal: 1000 } });

    await service.extrato(7, '2026-08-01', '2026-08-31');

    const [consulta] = prisma.fechamentoCaixa.findFirst.mock
      .calls[0] as ConsultaDeFechamento[];
    expect(consulta.where?.caixaId).toBe(7);
    expect(consulta.where?.ate?.lt).toEqual(new Date(2026, 7, 1));
    expect(consulta.orderBy).toEqual({ ate: 'desc' });
  });

  it('parte do saldo final do fechamento anterior', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [saida(1, 300), { ...saida(2, 500), tipo: 'ENTRADA' as const }],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    // 1000 + 500 de entrada - 300 de saída
    expect(e.resumo.saldoInicial).toBe(1000);
    expect(e.resumo.saldoEsperado).toBe(1200);
  });

  /*
   * O dinheiro entregue na rua sai da gaveta sem virar saída no IXC, e o troco
   * volta do mesmo jeito. Sem os dois nesta conta, o número na tela não seria o
   * que a pessoa tem na mão — que é a única coisa que este indicador serve para
   * dizer.
   */
  it('o que saiu com alguém sai da gaveta, mesmo sem estar no IXC', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [],
      movimentoDaRua: [
        { valor: 200, entregueEm: DENTRO, baixadoEm: null, troco: null },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.entregueNoPeriodo).toBe(200);
    expect(e.resumo.saldoEsperado).toBe(800);
  });

  it('o troco devolvido volta para a gaveta', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [],
      movimentoDaRua: [
        // Entregue no período anterior, prestou contas neste: só o troco entra.
        { valor: 200, entregueEm: new Date(2026, 6, 20), baixadoEm: DENTRO, troco: 50 },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.entregueNoPeriodo).toBe(0);
    expect(e.resumo.trocoNoPeriodo).toBe(50);
    expect(e.resumo.saldoEsperado).toBe(1050);
  });

  /*
   * Contagem vence cálculo. O primeiro caixa batido aqui fechou com R$ 0,00
   * calculados e a gaveta cheia — o saldo inicial informado foi zero, e o zero
   * atravessou o período inteiro. Se o encadeamento seguisse o calculado, todo
   * fechamento seguinte nasceria com o mesmo buraco.
   */
  it('parte da contagem do fechamento anterior, e não do que ele calculou', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 0, saldoContado: 3368 },
      lancamentos: [saida(1, 68)],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.saldoInicial).toBe(3368);
    expect(e.resumo.saldoEsperado).toBe(3300);
  });

  it('fechamento anterior sem contagem continua valendo pelo calculado', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000, saldoContado: null },
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.saldoInicial).toBe(1000);
  });

  /*
   * O dinheiro sai da gaveta uma vez só.
   *
   * Ele já saiu na entrega; a conta a pagar que a prestação lançou o faz sair
   * de novo, agora pelas saídas do IXC. Descontar os dois deixaria a gaveta
   * R$ 200,00 mais pobre na tela do que na mão de quem está contando.
   */
  it('o gasto que virou conta a pagar não desconta duas vezes', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      // A saída de 200 no IXC é a baixa da despesa que a prestação lançou.
      lancamentos: [saida(1, 200)],
      movimentoDaRua: [
        {
          valor: 204,
          entregueEm: DENTRO,
          baixadoEm: DENTRO,
          troco: 4,
          valorGasto: 200,
          gastoPagoEm: DENTRO,
        },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.gastoLancadoNoPeriodo).toBe(200);
    // 1000 - 204 que saiu + 4 de troco = 800, e a saída de 200 do IXC é a
    // mesma saída, não outra.
    expect(e.resumo.saldoEsperado).toBe(800);
  });

  it('gasto sem conta a pagar não compensa nada', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      movimentoDaRua: [
        {
          valor: 204,
          entregueEm: DENTRO,
          baixadoEm: DENTRO,
          troco: 4,
          valorGasto: 200,
          gastoPagoEm: null,
        },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.gastoLancadoNoPeriodo).toBe(0);
    expect(e.resumo.saldoEsperado).toBe(800);
  });

  it('entregue e prestado no mesmo período: sobra o que virou nota', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [],
      movimentoDaRua: [
        { valor: 200, entregueEm: DENTRO, baixadoEm: DENTRO, troco: 50 },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    // Saíram 200, voltaram 50: a gaveta ficou 150 menor.
    expect(e.resumo.saldoEsperado).toBe(850);
  });
});

describe('fechar o período', () => {
  it('recusa enquanto houver saída por conferir, e diz quantas', async () => {
    const { service } = montarServico({
      lancamentos: [saida(1, 100), saida(2, 250), saida(3, 10)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await expect(
      service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' }),
    ).rejects.toThrow(/faltam 2 saídas/i);
  });

  /*
   * Um caixa de provedor recebe muito mais do que paga: 109 recebimentos de
   * cliente para 52 saídas, no mês em que esta tela estreou. Os recebimentos
   * entram no saldo, mas exigir os 161 para fechar viraria marcação cega.
   */
  it('entrada não conferida não segura o fechamento', async () => {
    const { service, criados } = montarServico({
      lancamentos: [
        saida(1, 100),
        { ...saida(2, 900), tipo: 'ENTRADA' as const },
        { ...saida(3, 40), tipo: 'ENTRADA' as const },
      ],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await service.fechar({
      caixaId: 7,
      de: '2026-08-01',
      ate: '2026-08-31',
      saldoInicial: 0,
    });

    // O fechamento guarda a conferência que ele exigiu: a das saídas.
    expect(criados[0].lancamentos).toBe(1);
    expect(criados[0].conferidos).toBe(1);
    expect(Number(criados[0].totalEntradas)).toBe(940);
  });

  it('dinheiro na rua não impede fechar — vai registrado no fechamento', async () => {
    const { service, criados } = montarServico({
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
      naRua: [{ id: 'r1', pessoa: 'Jeferson', valor: 150, entregueEm: HOJE }],
    });

    await service.fechar(
      {
        caixaId: 7,
        de: '2026-08-01',
        ate: '2026-08-31',
        observacao: 'ok',
        saldoInicial: 0,
      },
      'u1',
    );

    expect(Number(criados[0].totalNaRua)).toBe(150);
    expect(criados[0].caixaNome).toBe('CX - Werick');
    expect(criados[0].conferidos).toBe(1);
  });

  /*
   * Assumir zero em silêncio seria pior que recusar: o erro entraria no
   * `saldoFinal`, e cada fechamento seguinte herdaria o dele — um caixa
   * inteiro errado por um número que ninguém chegou a informar.
   */
  it('caixa nunca fechado recusa sem o saldo inicial', async () => {
    const { service } = montarServico({
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await expect(
      service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' }),
    ).rejects.toThrow(/informe quanto havia na gaveta/i);
  });

  it('do segundo em diante, o anterior diz de onde parte', async () => {
    const { service, criados } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [saida(1, 300)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    // Sem informar nada: o saldo vem do fechamento anterior.
    await service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' });

    expect(Number(criados[0].saldoInicial)).toBe(1000);
    expect(Number(criados[0].saldoFinal)).toBe(700);
  });

  it('o saldo guardado é o da gaveta, com a rua descontada', async () => {
    const { service, criados } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
      movimentoDaRua: [
        { valor: 200, entregueEm: new Date(2026, 7, 10), baixadoEm: null, troco: null },
      ],
    });

    await service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' });

    // 1000 - 100 de saída - 200 que saiu com alguém
    expect(Number(criados[0].saldoFinal)).toBe(700);
  });

  /*
   * O estrago de um período sobreposto é silencioso: as saídas dos dias
   * repetidos entram duas vezes num saldo assinado, e o novo fechamento passa a
   * disputar com o antigo o posto de "anterior" do seguinte. Os números saem
   * plausíveis e errados.
   */
  it('recusa período que recomeça dentro do que já foi fechado', async () => {
    const { service } = montarServico({
      ultimo: { ate: new Date(2026, 7, 18) },
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await expect(
      service.fechar({
        caixaId: 7,
        de: '2026-08-01',
        ate: '2026-08-31',
        saldoInicial: 3368,
      }),
    ).rejects.toThrow(/já está fechado até 18\/08\/2026.*19\/08\/2026/s);
  });

  it('começando no dia seguinte ao último, fecha normalmente', async () => {
    const { service, criados } = montarServico({
      anterior: { saldoFinal: 0, saldoContado: 3368 },
      ultimo: { ate: new Date(2026, 7, 18) },
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await service.fechar({ caixaId: 7, de: '2026-08-19', ate: '2026-08-31' });

    expect(Number(criados[0].saldoInicial)).toBe(3368);
    expect(Number(criados[0].saldoFinal)).toBe(3268);
  });

  it('guarda a contagem da gaveta ao lado do que calculou', async () => {
    const { service, criados } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [saida(1, 300)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await service.fechar({
      caixaId: 7,
      de: '2026-08-01',
      ate: '2026-08-31',
      saldoContado: 690,
    });

    // Os dois convivem: o calculado é o que a soma diz, o contado é o que
    // existe. A diferença entre eles é o que se foi procurar.
    expect(Number(criados[0].saldoFinal)).toBe(700);
    expect(Number(criados[0].saldoContado)).toBe(690);
  });

  it('sem contar, o fechamento sai só com o calculado', async () => {
    const { service, criados } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [saida(1, 300)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' });

    expect(criados[0].saldoContado).toBeNull();
  });

  it('guarda os totais do momento, e não uma referência ao período', async () => {
    const { service, criados } = montarServico({
      lancamentos: [saida(1, 40), { ...saida(2, 60), tipo: 'ENTRADA' as const }],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await service.fechar({
      caixaId: 7,
      de: '2026-08-01',
      ate: '2026-08-31',
      saldoInicial: 0,
    });

    expect(Number(criados[0].totalSaidas)).toBe(40);
    expect(Number(criados[0].totalEntradas)).toBe(60);
  });
});

/*
 * A correção existe por causa do primeiro caixa batido: ele fechou com o
 * calculado, a gaveta tinha outro valor, e sem poder corrigir a contagem o
 * único caminho seria começar de novo — apagando um fechamento assinado.
 */
describe('corrigir a contagem de um fechamento', () => {
  const fechamento = { id: 'f1', caixaId: 7, saldoFinal: 0, saldoContado: null };

  it('grava a contagem do último fechamento do caixa', async () => {
    const { service, prisma } = montarServico({
      fechamento,
      ultimo: fechamento,
    });

    await service.corrigirContagem('f1', 3368, 'u1');

    const [{ data }] = prisma.fechamentoCaixa.update.mock.calls[0];
    expect(Number(data.saldoContado)).toBe(3368);
  });

  /*
   * Os totais de um fechamento são cópia do que se viu no dia. Mexer num do
   * meio deixaria os seguintes apoiados num saldo que não existe mais, e nada
   * na tela diria isso.
   */
  it('recusa corrigir um fechamento que já tem outro depois dele', async () => {
    const { service } = montarServico({
      fechamento,
      ultimo: { id: 'f2', caixaId: 7, saldoFinal: 500, saldoContado: null },
    });

    await expect(service.corrigirContagem('f1', 3368)).rejects.toThrow(
      /já foi fechado de novo/i,
    );
  });

  it('recusa contagem negativa', async () => {
    const { service } = montarServico({ fechamento, ultimo: fechamento });

    await expect(service.corrigirContagem('f1', -1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('fechamento que não existe não se corrige', async () => {
    const { service } = montarServico({ fechamento: null, ultimo: null });

    await expect(service.corrigirContagem('f9', 100)).rejects.toThrow(
      /não existe/i,
    );
  });
});
