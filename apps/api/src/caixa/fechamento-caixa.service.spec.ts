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
      findMany: jest.fn().mockResolvedValue(opts.naRua ?? []),
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

describe('fechar o período', () => {
  it('recusa enquanto houver lançamento por conferir, e diz quantos', async () => {
    const { service } = montarServico({
      lancamentos: [saida(1, 100), saida(2, 250), saida(3, 10)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await expect(
      service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' }),
    ).rejects.toThrow(/faltam 2 lançamentos/i);
  });

  it('dinheiro na rua não impede fechar — vai registrado no fechamento', async () => {
    const { service, criados } = montarServico({
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
      naRua: [{ id: 'r1', pessoa: 'Jeferson', valor: 150, entregueEm: HOJE }],
    });

    await service.fechar(
      { caixaId: 7, de: '2026-08-01', ate: '2026-08-31', observacao: 'ok' },
      'u1',
    );

    expect(Number(criados[0].totalNaRua)).toBe(150);
    expect(criados[0].caixaNome).toBe('CX - Werick');
    expect(criados[0].conferidos).toBe(1);
  });

  it('guarda os totais do momento, e não uma referência ao período', async () => {
    const { service, criados } = montarServico({
      lancamentos: [saida(1, 40), { ...saida(2, 60), tipo: 'ENTRADA' as const }],
      conferencias: [
        { idLancamentoIxc: 1, conferido: true },
        { idLancamentoIxc: 2, conferido: true },
      ],
    });

    await service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' });

    expect(Number(criados[0].totalSaidas)).toBe(40);
    expect(Number(criados[0].totalEntradas)).toBe(60);
  });
});
