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
 *  - a conta de quem levou dinheiro se acerta aos poucos, e o saldo dela nunca
 *    fica negativo por engano de digitação;
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
    conferencias?: Array<{
      idLancamentoIxc: number;
      conferido: boolean;
      qtdNotas?: number;
    }>;
    /** Contas abertas agora, com os acertos que já tiveram. */
    naRua?: Array<Record<string, unknown>>;
    /** A conta que `lancarMovimento` vai buscar pelo id. */
    entrega?: Record<string, unknown> | null;
    /** O fechamento anterior deste caixa, de onde o saldo parte. */
    anterior?: Record<string, unknown> | null;
    /** Entregas com data dentro do período. */
    entregasDoPeriodo?: Array<Record<string, unknown>>;
    /** Acertos com data (ou baixa no IXC) dentro do período. */
    movimentosDoPeriodo?: Array<Record<string, unknown>>;
    /** O último acerto de uma conta, para `desfazerMovimento`. */
    ultimoMovimento?: Record<string, unknown> | null;
    /** O acerto que `desfazerMovimento` vai buscar pelo id. */
    movimento?: Record<string, unknown> | null;
    /** O fechamento que `corrigirContagem` vai buscar pelo id. */
    fechamento?: Record<string, unknown> | null;
    /** O último fechamento do caixa, para a correção saber se pode. */
    ultimo?: Record<string, unknown> | null;
    /** O que o lançamento da despesa devolve. */
    despesaLancada?: Record<string, unknown>;
    /** Diárias assinadas, pagas em mãos, à espera de virar nota. */
    diariasAssinadas?: Array<Record<string, unknown>>;
  } = {},
) {
  const lancamentos = opts.lancamentos ?? [];
  const criados: Record<string, unknown>[] = [];

  const prisma = {
    conferenciaCaixa: {
      findMany: jest.fn().mockResolvedValue(
        (opts.conferencias ?? []).map((c) => ({
          _count: { fotos: c.qtdNotas ?? 0 },
          ...c,
        })),
      ),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        id: 'cf1',
        notaFoto: 'data:image/png;base64,AAAA',
        ...create,
      })),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    diaria: {
      findMany: jest.fn().mockResolvedValue(opts.diariasAssinadas ?? []),
    },
    dinheiroNaRua: {
      // Primeira chamada: as contas abertas. Segunda: as entregas do período,
      // para o saldo da gaveta.
      findMany: jest
        .fn()
        .mockResolvedValueOnce(
          (opts.naRua ?? []).map((d) => ({ movimentos: [], ...d })),
        )
        .mockResolvedValue(opts.entregasDoPeriodo ?? []),
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.entrega ? { movimentos: [], ...opts.entrega } : null,
        ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'r1',
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'r1',
        pessoa: 'Jeferson',
        ...data,
      })),
      delete: jest.fn(),
    },
    fotoDaNota: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'f1',
        ...data,
      })),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    },
    movimentoDaRua: {
      findMany: jest.fn().mockResolvedValue(opts.movimentosDoPeriodo ?? []),
      findFirst: jest.fn().mockResolvedValue(opts.ultimoMovimento ?? null),
      findUnique: jest.fn().mockResolvedValue(opts.movimento ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'm1',
        notaFoto: null,
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

  const pagamentos = {
    // O IXC recusa apagar título já pago; quem chama trata a recusa.
    excluir: jest.fn().mockResolvedValue({ idFnApagar: 4242 }),
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
    pagamentos as never,
  );
  return { service, prisma, caixa, criados, despesas, pagamentos };
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

  it('a foto não vem na listagem, só quantas existem', async () => {
    const { service } = montarServico({
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true, qtdNotas: 2 }],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.lancamentos[0].qtdNotas).toBe(2);
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

  /*
   * O recorte de um dia só era o intervalo vazio [00:00, 00:00]: uma saída
   * anotada às duas da tarde ficava de fora, e a gaveta nao se mexia com ela.
   * Só o que nasce com hora zerada escapava, que é por que demorou a aparecer.
   */
  it('o período vai até o fim do último dia, e não até a meia-noite dele', async () => {
    const { service, prisma } = montarServico();

    await service.extrato(7, '2026-08-19', '2026-08-19');

    // A segunda chamada é a das entregas do período.
    const [consulta] = prisma.dinheiroNaRua.findMany.mock.calls[1] as Array<{
      where: { entregueEm: { gte: Date; lte: Date } };
    }>;
    expect(consulta.where.entregueEm.gte).toEqual(new Date(2026, 7, 19));
    expect(consulta.where.entregueEm.lte).toEqual(
      new Date(2026, 7, 19, 23, 59, 59, 999),
    );
  });

  it('uma entrega da tarde de hoje entra no período de hoje', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      // É assim que ela nasce: `new Date()` na hora em que foi anotada.
      entregasDoPeriodo: [{ valor: 50 }],
    });

    const e = await service.extrato(7, '2026-08-19', '2026-08-19');

    expect(e.resumo.entregueNoPeriodo).toBe(50);
    expect(e.resumo.saldoEsperado).toBe(950);
  });

  /*
   * A nota daquele pagamento já existe neste sistema: é o recibo que a pessoa
   * assinou com o dedo. Sem a ligação, quem fecha o caixa imprimia o recibo,
   * fotografava o papel e anexava a foto do papel que o sistema gerou.
   */
  it('o recibo assinado do diarista vira a nota da saída dele', async () => {
    const { service, prisma } = montarServico({
      lancamentos: [
        { ...saida(90, 290), historico: 'Pag. João da Silva - doc.: 12' },
      ],
      diariasAssinadas: [
        { id: 'dia1', valor: 290, diarista: { nome: 'João da Silva', nomeFantasia: null } },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    const [{ data }] = prisma.fotoDaNota.create.mock.calls[0];
    expect(data.diariaId).toBe('dia1');
    // A tela recebe o número já certo, sem precisar de outra ida.
    expect(e.lancamentos[0].qtdNotas).toBe(1);
  });

  it('valor igual mas outro nome não casa', async () => {
    const { service, prisma } = montarServico({
      lancamentos: [
        { ...saida(90, 290), historico: 'Pag. Auto Peças Silva - doc.: 12' },
      ],
      diariasAssinadas: [
        { id: 'dia1', valor: 290, diarista: { nome: 'Jeferson Alves', nomeFantasia: null } },
      ],
    });

    await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(prisma.fotoDaNota.create).not.toHaveBeenCalled();
  });

  it('saída que já tem nota não recebe o recibo por cima', async () => {
    const { service, prisma } = montarServico({
      lancamentos: [
        { ...saida(90, 290), historico: 'Pag. João da Silva - doc.: 12' },
      ],
      conferencias: [{ idLancamentoIxc: 90, conferido: false, qtdNotas: 1 }],
      diariasAssinadas: [
        { id: 'dia1', valor: 290, diarista: { nome: 'João da Silva', nomeFantasia: null } },
      ],
    });

    await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(prisma.fotoDaNota.create).not.toHaveBeenCalled();
  });

  it('recusa período de trás para frente', async () => {
    const { service } = montarServico();
    await expect(service.extrato(7, '2026-08-31', '2026-08-01')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('a conta de quem levou dinheiro', () => {
  /** R$ 204,00 com a Idelblane, nada acertado ainda. */
  const conta = {
    id: 'r1',
    caixaId: 7,
    pessoa: 'Idelblane',
    valor: 204,
    entregueEm: new Date(2026, 7, 14),
    baixadoEm: null,
    movimentos: [],
  };

  const despesa = {
    idFornecedorIxc: 55,
    fornecedorNome: 'Auto Peças Silva',
    descricao: 'Correia do gerador',
  };

  /*
   * O caso que derrubou a regra antiga: leva 204, traz nota de 100 e fica com
   * os outros 104 para a próxima compra. Exigir que nota e troco fechassem a
   * entrega inteira obrigava a mentir num dos dois campos.
   */
  it('nota parcial desce o saldo e deixa a conta aberta', async () => {
    const { service, prisma } = montarServico({ entrega: conta });

    const r = await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      data: '2026-08-15',
    });

    expect(r.saldo).toBe(104);
    expect(r.acertada).toBe(false);
    expect(prisma.dinheiroNaRua.update).not.toHaveBeenCalled();
  });

  it('o reforço sobe o saldo: saiu mais dinheiro para completar a compra', async () => {
    const { service } = montarServico({
      entrega: {
        ...conta,
        movimentos: [{ tipo: 'NOTA', valor: 100 }],
      },
    });

    const r = await service.lancarMovimento('r1', {
      tipo: 'REFORCO',
      valor: 50,
    });

    // 204 - 100 de nota + 50 que saiu agora
    expect(r.saldo).toBe(154);
  });

  it('zerando o saldo, a conta se acerta sozinha', async () => {
    const { service, prisma } = montarServico({
      entrega: { ...conta, movimentos: [{ tipo: 'NOTA', valor: 200 }] },
    });

    const r = await service.lancarMovimento('r1', { tipo: 'TROCO', valor: 4 }, 'u1');

    expect(r.saldo).toBe(0);
    expect(r.acertada).toBe(true);
    const [{ data }] = prisma.dinheiroNaRua.update.mock.calls[0];
    expect(data.baixadoEm).toBeInstanceOf(Date);
  });

  /*
   * Nota maior que o saldo é sempre engano de digitação, e deixaria a pessoa
   * devendo negativo — um negativo que entraria no total da rua abatendo o
   * saldo de quem realmente está com dinheiro.
   */
  it('recusa acerto maior que o saldo, e diz quanto está com a pessoa', async () => {
    const { service } = montarServico({ entrega: conta });

    await expect(
      service.lancarMovimento('r1', { tipo: 'NOTA', valor: 300 }),
      // `\s` e não um espaço literal: o pt-BR separa o "R$" do número com
      // espaço não separável, e um espaço comum aqui nunca casaria.
    ).rejects.toThrow(/está com R\$\s204,00/);
  });

  it('o reforço pode passar do saldo: ele é dinheiro saindo, não acerto', async () => {
    const { service } = montarServico({ entrega: conta });

    const r = await service.lancarMovimento('r1', { tipo: 'REFORCO', valor: 500 });

    expect(r.saldo).toBe(704);
  });

  it('conta já acertada não recebe lançamento novo', async () => {
    const { service } = montarServico({
      entrega: { ...conta, baixadoEm: new Date(2026, 7, 15) },
    });

    await expect(
      service.lancarMovimento('r1', { tipo: 'NOTA', valor: 10 }),
    ).rejects.toThrow(/já foi acertada/i);
  });

  it('valor zero ou negativo não é lançamento', async () => {
    const { service } = montarServico({ entrega: conta });

    await expect(
      service.lancarMovimento('r1', { tipo: 'TROCO', valor: 0 }),
    ).rejects.toThrow(/maior que zero/i);
  });

  it('só a nota vira despesa — troco e reforço não são gasto', async () => {
    const { service } = montarServico({ entrega: conta });

    await expect(
      service.lancarMovimento('r1', { tipo: 'TROCO', valor: 10, despesa }),
    ).rejects.toThrow(/só a nota vira conta a pagar/i);
  });

  // --- A despesa que a nota lança ---

  it('a despesa é lançada no caixa da entrega, quitada na data em que saiu', async () => {
    const { service, despesas } = montarServico({ entrega: conta });

    await service.lancarMovimento(
      'r1',
      { tipo: 'NOTA', valor: 100, despesa: { ...despesa, pagoEm: '2026-08-10' } },
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

  it('sem data na despesa, ela cai no dia do lançamento', async () => {
    const { service, despesas } = montarServico({ entrega: conta });

    await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      data: '2026-08-03',
      despesa,
    });

    expect(despesas.lancar.mock.calls[0][0].dataPagamento).toBe('2026-08-03');
  });

  it('guarda o título e o dia da saída, que é o que evita o desconto em dobro', async () => {
    const { service, prisma } = montarServico({ entrega: conta });

    await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      despesa: { ...despesa, pagoEm: '2026-08-10' },
    });

    const [{ data }] = prisma.movimentoDaRua.create.mock.calls[0];
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
      entrega: conta,
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

    const r = await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      despesa: { ...despesa, pagoEm: '2026-08-10' },
    });

    const [{ data }] = prisma.movimentoDaRua.create.mock.calls[0];
    expect(data.gastoPagoEm).toBeNull();
    expect(r.despesa?.paga).toBe(false);
    expect(r.despesa?.avisos.length).toBeGreaterThan(0);
  });

  /*
   * O lançamento fechado não se lança de novo. Se ele viesse antes da despesa,
   * uma falha do IXC deixaria o saldo abatido aqui e a despesa em lugar nenhum.
   */
  it('despesa que nem chegou a ser lançada não abate o saldo', async () => {
    const { service, prisma, despesas } = montarServico({ entrega: conta });
    despesas.lancar.mockRejectedValueOnce(new Error('IXC fora do ar'));

    await expect(
      service.lancarMovimento('r1', { tipo: 'NOTA', valor: 100, despesa }),
    ).rejects.toThrow(/IXC fora do ar/);

    expect(prisma.movimentoDaRua.create).not.toHaveBeenCalled();
  });

  /*
   * A saída nasce da prestação já revisada: pedir que alguém a marque de novo,
   * e fotografe de novo a mesma nota, é trabalho repetido por um detalhe de
   * arquitetura — a foto do acerto mora num lugar e a da conferência noutro.
   */
  /*
   * A foto viaja; o "olhei" não. Quem presta contas e quem confere o caixa não
   * são o mesmo gesto, e dar por conferido o que a própria pessoa acabou de
   * lançar tira da conferência o sentido que ela tem.
   */
  it('a saída criada no IXC recebe as fotos, e continua por conferir', async () => {
    const { service, prisma } = montarServico({
      entrega: conta,
      lancamentos: [saida(77, 100)],
    });

    await service.lancarMovimento(
      'r1',
      {
        tipo: 'NOTA',
        valor: 100,
        notasFoto: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'],
        despesa: { ...despesa, pagoEm: '2026-08-19' },
      },
      'u1',
    );

    const [chamada] = prisma.conferenciaCaixa.upsert.mock.calls[0] as Array<{
      create: Record<string, unknown>;
    }>;
    expect(chamada.create.idLancamentoIxc).toBe(77);
    expect(chamada.create.conferido).toBeUndefined();

    const [criadas] = prisma.fotoDaNota.createMany.mock.calls[0] as Array<{
      data: Array<Record<string, unknown>>;
    }>;
    expect(criadas.data).toHaveLength(2);
  });

  /*
   * Duas saídas iguais no mesmo dia: a segunda tem de achar a segunda. Sem
   * isto, o segundo acerto marcaria de novo o lançamento do primeiro e deixaria
   * um por conferir para sempre.
   */
  it('não toma uma saída que já tem foto', async () => {
    const { service, prisma } = montarServico({
      entrega: conta,
      lancamentos: [saida(77, 100), saida(78, 100)],
      conferencias: [{ idLancamentoIxc: 77, conferido: true, qtdNotas: 1 }],
    });

    await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      notasFoto: ['data:image/png;base64,AAAA'],
      despesa: { ...despesa, pagoEm: '2026-08-19' },
    });

    const [chamada] = prisma.conferenciaCaixa.upsert.mock.calls[0] as Array<{
      create: Record<string, unknown>;
    }>;
    expect(chamada.create.idLancamentoIxc).toBe(78);
  });

  it('acerto sem despesa não mexe na conferência', async () => {
    const { service, prisma } = montarServico({
      entrega: conta,
      lancamentos: [saida(77, 100)],
    });

    await service.lancarMovimento('r1', { tipo: 'TROCO', valor: 100 });

    expect(prisma.conferenciaCaixa.upsert).not.toHaveBeenCalled();
  });

  /*
   * Isto é conveniência — poupar a segunda foto da mesma nota. Derrubar por
   * causa dela um acerto que já escreveu no IXC seria trocar um incômodo por
   * um estrago.
   */
  it('não achando a saída no IXC, o acerto passa assim mesmo', async () => {
    const { service, prisma } = montarServico({
      entrega: conta,
      lancamentos: [],
    });

    const r = await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      notasFoto: ['data:image/png;base64,AAAA'],
      despesa: { ...despesa, pagoEm: '2026-08-19' },
    });

    expect(r.saldo).toBe(104);
    expect(prisma.conferenciaCaixa.upsert).not.toHaveBeenCalled();
  });

  // --- Desfazer ---

  it('desfaz um lançamento e reabre a conta', async () => {
    const m = { id: 'm1', entregaId: 'r1', idFnApagarIxc: null };
    const { service, prisma } = montarServico({ movimento: m });

    await service.desfazerMovimento('m1');

    expect(prisma.movimentoDaRua.delete).toHaveBeenCalled();
    const [{ data }] = prisma.dinheiroNaRua.update.mock.calls[0];
    expect(data.baixadoEm).toBeNull();
  });

  /*
   * O saldo é uma soma: some qualquer parcela que se tire. Obrigar a desfazer
   * de trás para frente era burocracia — quem digita 100 no lugar de 10 percebe
   * depois de já ter lançado o troco.
   */
  it('desfaz qualquer lançamento, e não só o último', async () => {
    const { service, prisma } = montarServico({
      movimento: { id: 'm1', entregaId: 'r1', idFnApagarIxc: null },
      ultimoMovimento: { id: 'm2', entregaId: 'r1', idFnApagarIxc: null },
    });

    await service.desfazerMovimento('m1');

    expect(prisma.movimentoDaRua.delete).toHaveBeenCalled();
  });

  /*
   * Apagar só deste lado deixaria a saída viva no IXC: o caixa passaria a
   * descontar um dinheiro que ninguém compensa, e a gaveta apareceria menor.
   */
  it('lançamento com título leva o título junto', async () => {
    const { service, pagamentos, prisma } = montarServico({
      movimento: { id: 'm1', entregaId: 'r1', idFnApagarIxc: 4242 },
    });

    await service.desfazerMovimento('m1');

    expect(pagamentos.excluir).toHaveBeenCalledWith(4242);
    expect(prisma.movimentoDaRua.delete).toHaveBeenCalled();
  });

  it('título que o IXC não deixa apagar segura o desfazer, e diz o número', async () => {
    const { service, prisma, pagamentos } = montarServico({
      movimento: { id: 'm1', entregaId: 'r1', idFnApagarIxc: 4242 },
    });
    pagamentos.excluir.mockRejectedValueOnce(
      new Error('O título 4242 já foi pago.'),
    );

    await expect(service.desfazerMovimento('m1')).rejects.toThrow(/#4242/);
    expect(prisma.movimentoDaRua.delete).not.toHaveBeenCalled();
  });

  it('desfazer tudo volta a conta ao valor entregue', async () => {
    const { service, prisma } = montarServico({
      entrega: {
        ...conta,
        movimentos: [
          { id: 'm1', entregaId: 'r1', idFnApagarIxc: null, tipo: 'NOTA', valor: 100 },
          { id: 'm2', entregaId: 'r1', idFnApagarIxc: null, tipo: 'TROCO', valor: 4 },
        ],
      },
      movimento: { id: 'm1', entregaId: 'r1', idFnApagarIxc: null },
    });

    const r = await service.desfazerAcertos('r1');

    expect(r.desfeitos).toBe(2);
    expect(r.mantidos).toEqual([]);
    expect(prisma.movimentoDaRua.delete).toHaveBeenCalledTimes(2);
  });

  /* Desfazer pela metade em silêncio seria pior que não desfazer. */
  it('desfazer tudo devolve nomeado o que não deu para desfazer', async () => {
    const { service, pagamentos } = montarServico({
      entrega: {
        ...conta,
        movimentos: [
          { id: 'm1', entregaId: 'r1', idFnApagarIxc: 4242, tipo: 'NOTA', valor: 100 },
        ],
      },
      movimento: { id: 'm1', entregaId: 'r1', idFnApagarIxc: 4242 },
    });
    pagamentos.excluir.mockRejectedValue(new Error('O título 4242 já foi pago.'));

    const r = await service.desfazerAcertos('r1');

    expect(r.desfeitos).toBe(0);
    expect(r.mantidos).toHaveLength(1);
    expect(r.mantidos[0]).toMatch(/#4242/);
  });

  it('não apaga conta que já tem acerto lançado', async () => {
    const { service } = montarServico({
      entrega: { ...conta, movimentos: [{ id: 'm1' }] },
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
      entregasDoPeriodo: [{ valor: 200 }],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.entregueNoPeriodo).toBe(200);
    expect(e.resumo.saldoEsperado).toBe(800);
  });

  /* O reforço é dinheiro saindo da gaveta pelo mesmo motivo que a entrega. */
  it('o reforço pesa na gaveta como uma entrega', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [],
      movimentosDoPeriodo: [{ tipo: 'REFORCO', valor: 50, data: DENTRO }],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.entregueNoPeriodo).toBe(50);
    expect(e.resumo.saldoEsperado).toBe(950);
  });

  it('o troco devolvido volta para a gaveta', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [],
      // Entregue no período anterior, devolveu neste: só o troco entra.
      movimentosDoPeriodo: [{ tipo: 'TROCO', valor: 50, data: DENTRO }],
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
      // A saída de 200 no IXC é a baixa da despesa que a nota lançou.
      lancamentos: [saida(1, 200)],
      entregasDoPeriodo: [{ valor: 204 }],
      movimentosDoPeriodo: [
        { tipo: 'NOTA', valor: 200, data: DENTRO, gastoPagoEm: DENTRO },
        { tipo: 'TROCO', valor: 4, data: DENTRO, gastoPagoEm: null },
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
      entregasDoPeriodo: [{ valor: 204 }],
      movimentosDoPeriodo: [
        { tipo: 'NOTA', valor: 200, data: DENTRO, gastoPagoEm: null },
        { tipo: 'TROCO', valor: 4, data: DENTRO, gastoPagoEm: null },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.gastoLancadoNoPeriodo).toBe(0);
    expect(e.resumo.saldoEsperado).toBe(800);
  });

  it('entregue e acertado no mesmo período: sobra o que virou nota', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [],
      entregasDoPeriodo: [{ valor: 200 }],
      movimentosDoPeriodo: [
        { tipo: 'NOTA', valor: 150, data: DENTRO, gastoPagoEm: null },
        { tipo: 'TROCO', valor: 50, data: DENTRO, gastoPagoEm: null },
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
      entregasDoPeriodo: [{ valor: 200 }],
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
