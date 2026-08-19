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
 *  - a foto nunca sai numa listagem.
 */

const HOJE = new Date('2026-08-18T12:00:00Z');

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
      findFirst: jest.fn().mockResolvedValue(opts.anterior ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        criados.push(data);
        return { id: 'f1', ...data };
      }),
    },
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
  );
  return { service, prisma, caixa, criados };
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

    const [{ where, orderBy }] = prisma.fechamentoCaixa.findFirst.mock.calls[0];
    expect(where.caixaId).toBe(7);
    expect(where.ate.lt).toEqual(new Date(2026, 7, 1));
    expect(orderBy).toEqual({ ate: 'desc' });
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
