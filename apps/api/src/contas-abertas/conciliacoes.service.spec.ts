import { BadRequestException } from '@nestjs/common';
import { ConciliacoesService } from './conciliacoes.service';

/**
 * A conciliação com começo e fim.
 *
 * A regra que dá sentido à tela é uma só: **não fecha com pendência**. Um fecho
 * com transação do banco sem lançamento é um período dado por conferido sem ter
 * sido — e depois ninguém distingue um do outro. Quase tudo aqui protege isso,
 * e os caminhos legítimos de sair da pendência: ligar, conferir, ou explicar
 * por que aquela linha não é do contas a pagar.
 */

const CONTA = {
  id: 14,
  nome: 'Conta Sicoob',
  tipo: 'B',
  razao: 6531,
  ativa: true,
  usual: true,
  codigoBanco: '756',
};

function linhaIxc(
  id: number,
  valor: number,
  extras: { conciliadoNoIxc?: boolean; conferida?: unknown } = {},
) {
  return {
    id,
    data: '2026-08-13',
    historico: 'Pag. Fulano',
    documento: null,
    valor,
    conciliadoNoIxc: extras.conciliadoNoIxc ?? false,
    conferida: extras.conferida ?? null,
    titulo: null,
    extrato: null,
  };
}

function transacao(fitId: string, valor: number, extras: Record<string, unknown> = {}) {
  return {
    id: `t-${fitId}`,
    fitId,
    data: new Date('2026-08-13T00:00:00Z'),
    valor,
    descricao: 'PIX ENVIADO',
    documento: null,
    idMovimFinan: null,
    casadaAuto: false,
    casadaEm: null,
    ignorada: false,
    motivo: null,
    ...extras,
  };
}

function montarServico(opts: {
  status?: 'ABERTA' | 'FECHADA';
  linhas?: ReturnType<typeof linhaIxc>[];
  transacoes?: ReturnType<typeof transacao>[];
} = {}) {
  const registro = {
    id: 'c1',
    numero: 37,
    contaIxc: 14,
    contaNome: 'Conta Sicoob',
    de: new Date('2026-08-01T00:00:00Z'),
    ate: new Date('2026-08-31T00:00:00Z'),
    status: opts.status ?? 'ABERTA',
    datasDiferentes: true,
    extratoArquivo: 'extrato.ofx',
    extratoBanco: '756',
    extratoConta: '12345',
    extratoSaldo: null,
    extratoSaldoEm: null,
    fechadaEm: null,
    fechadaPor: null,
    criadaPor: 'Aurélio',
    createdAt: new Date('2026-08-18T00:00:00Z'),
    transacoes: opts.transacoes ?? [],
  };

  const prisma = {
    conciliacao: {
      findUnique: jest.fn().mockResolvedValue(registro),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { ...registro, _count: { transacoes: registro.transacoes.length }, transacoes: [] },
      ]),
      update: jest.fn().mockResolvedValue(registro),
      create: jest.fn(),
      delete: jest.fn(),
    },
    conciliacaoTransacao: {
      findMany: jest.fn().mockResolvedValue(registro.transacoes),
      findFirst: jest.fn().mockResolvedValue(registro.transacoes[0] ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    conciliacaoLinha: {
      upsert: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const conciliacao = {
    contas: jest.fn().mockResolvedValue([CONTA]),
    linhasDaConta: jest.fn().mockResolvedValue({
      conta: CONTA,
      de: '2026-08-01',
      ate: '2026-08-31',
      linhas: opts.linhas ?? [],
      cruas: [],
      avisos: [],
    }),
  };

  const service = new ConciliacoesService(prisma as never, conciliacao as never);
  return { service, prisma, conciliacao, registro };
}

describe('o que impede uma conciliação de fechar', () => {
  it('transação do banco sem lançamento segura o fecho, e diz quantas', async () => {
    const { service } = montarServico({
      linhas: [linhaIxc(1, -100)],
      transacoes: [transacao('a', -100, { idMovimFinan: 1 }), transacao('b', -42)],
    });

    await expect(service.fechar('c1', 'Aurélio')).rejects.toThrow(
      /1 transação\(ões\) do banco sem lançamento/i,
    );
  });

  it('linha do IXC sem par no extrato também segura', async () => {
    const { service } = montarServico({
      linhas: [linhaIxc(1, -100), linhaIxc(2, -55)],
      transacoes: [transacao('a', -100, { idMovimFinan: 1 })],
    });

    await expect(service.fechar('c1')).rejects.toThrow(BadRequestException);
  });

  it('linha já conciliada no IXC não é pendência — ela foi conferida por outro caminho', async () => {
    const { service, prisma } = montarServico({
      linhas: [linhaIxc(1, -100), linhaIxc(2, -55, { conciliadoNoIxc: true })],
      transacoes: [transacao('a', -100, { idMovimFinan: 1 })],
    });

    await service.fechar('c1', 'Aurélio');

    const [{ data }] = prisma.conciliacao.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data.status).toBe('FECHADA');
    expect(data.fechadaPor).toBe('Aurélio');
  });

  it('transação ignorada com motivo sai da conta das pendências', async () => {
    const { service, prisma } = montarServico({
      linhas: [linhaIxc(1, -100)],
      transacoes: [
        transacao('a', -100, { idMovimFinan: 1 }),
        transacao('b', -42, { ignorada: true, motivo: 'tarifa lançada pela contabilidade' }),
      ],
    });

    await service.fechar('c1');

    expect(prisma.conciliacao.update).toHaveBeenCalled();
  });

  it('congela os totais no fecho: refazer a conta depois daria outro número', async () => {
    const { service, prisma } = montarServico({
      linhas: [linhaIxc(1, -100), linhaIxc(2, 250, { conciliadoNoIxc: true })],
      transacoes: [transacao('a', -100, { idMovimFinan: 1 })],
    });

    await service.fechar('c1');

    const [{ data }] = prisma.conciliacao.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data.totalSaidas).toBe(100);
    expect(data.totalEntradas).toBe(250);
    expect(data.totalLinhas).toBe(2);
  });

  it('fechada não fecha de novo', async () => {
    const { service } = montarServico({ status: 'FECHADA' });
    await expect(service.fechar('c1')).rejects.toThrow(/já está fechada/i);
  });
});

describe('mexer numa conciliação fechada', () => {
  it('é recusado, e a mensagem diz o caminho', async () => {
    const { service } = montarServico({ status: 'FECHADA' });

    await expect(service.casarAutomatico('c1')).rejects.toThrow(/Reabra/i);
    await expect(
      service.ligar('c1', { fitId: 'a', idMovimFinan: 1 }),
    ).rejects.toThrow(/Reabra/i);
    await expect(service.ignorar('c1', 'a', 'tarifa')).rejects.toThrow(/Reabra/i);
  });

  it('não se apaga: é a prova de que alguém conferiu aquele período', async () => {
    const { service } = montarServico({ status: 'FECHADA' });
    await expect(service.apagar('c1')).rejects.toThrow(/está fechada/i);
  });
});

describe('abrir uma conciliação', () => {
  it('devolve os dois lados e diz onde está cada par', async () => {
    const { service } = montarServico({
      linhas: [linhaIxc(1, -100), linhaIxc(2, -55)],
      transacoes: [transacao('a', -100, { idMovimFinan: 1, casadaAuto: true })],
    });

    const aberta = await service.abrir('c1');

    expect(aberta.conciliacao.numero).toBe(37);
    expect(aberta.linhas[0].extrato).toMatchObject({ fitId: 'a', valor: -100 });
    expect(aberta.linhas[1].extrato).toBeNull();
    expect(aberta.resumo.linhasLigadas).toBe(1);
    expect(aberta.resumo.linhasPendentes).toBe(1);
    expect(aberta.resumo.transacoesPendentes).toBe(0);
    expect(aberta.resumo.podeFechar).toBe(false);
  });

  it('sem pendência dos dois lados, libera o fecho', async () => {
    const { service } = montarServico({
      linhas: [linhaIxc(1, -100)],
      transacoes: [transacao('a', -100, { idMovimFinan: 1 })],
    });

    const aberta = await service.abrir('c1');
    expect(aberta.resumo.podeFechar).toBe(true);
  });
});

describe('a ligação na mão', () => {
  it('recusa ligar uma linha do IXC que já está com outra transação', async () => {
    const { service, prisma } = montarServico({
      linhas: [linhaIxc(1, -100)],
      transacoes: [transacao('a', -100, { idMovimFinan: 1 })],
    });
    prisma.conciliacaoTransacao.findFirst.mockResolvedValue({
      fitId: 'a',
      data: new Date('2026-08-13T00:00:00Z'),
      valor: -100,
    });

    await expect(
      service.ligar('c1', { fitId: 'b', idMovimFinan: 1 }),
    ).rejects.toThrow(/já está ligada/i);
  });

  it('recusa ligar a uma linha que não é do período', async () => {
    const { service, prisma } = montarServico({ linhas: [linhaIxc(1, -100)] });
    prisma.conciliacaoTransacao.findFirst.mockResolvedValue(null);

    await expect(
      service.ligar('c1', { fitId: 'b', idMovimFinan: 999 }),
    ).rejects.toThrow(/não está na movimentação/i);
  });

  it('ao desligar, tira a conferência que a própria conciliação criou', async () => {
    const { service, prisma } = montarServico({
      transacoes: [transacao('a', -100, { idMovimFinan: 1 })],
    });
    prisma.conciliacaoTransacao.findFirst.mockResolvedValue(
      transacao('a', -100, { idMovimFinan: 1 }),
    );

    await service.desligar('c1', 'a');

    const [{ where }] = prisma.conciliacaoLinha.deleteMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    // A marca de outra conciliação, ou solta, continua de pé.
    expect(where).toEqual({ idMovimFinan: 1, conciliacaoId: 'c1' });
  });
});
