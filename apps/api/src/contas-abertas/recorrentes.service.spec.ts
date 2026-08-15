import { mesSeguinte, RecorrentesService } from './recorrentes.service';

/**
 * A conta que se repete todo mês nasce sozinha. O que este arquivo protege:
 *
 *  - ela nasce só dentro da janela de antecedência — criar doze meses de uma
 *    vez faria o total em aberto da empresa saltar por serviço não prestado;
 *  - o vencimento só anda quando a conta de fato nasceu no IXC, senão uma
 *    falha pularia o mês inteiro sem ninguém notar;
 *  - dia 31 em mês de 30 não escorrega para o mês seguinte.
 */

const HOJE = new Date('2026-08-15T09:00:00Z');

function recorrente(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    idFornecedorIxc: 196,
    fornecedorNome: 'Provedor de Link',
    valor: 1200,
    observacao: 'Link de internet',
    proximoVencimento: new Date(Date.UTC(2026, 7, 20)), // 20/08
    diasDeAntecedencia: 5,
    contaContabil: null,
    contaPagamento: null,
    tipoPagamentoIxc: null,
    categoriaId: null,
    ativa: true,
    ...over,
  };
}

function montarServico(
  opts: { lista?: unknown[]; erroAoCriar?: string } = {},
) {
  const atualizacoes: Array<Record<string, unknown>> = [];

  const prisma = {
    despesaRecorrente: {
      findMany: jest.fn().mockResolvedValue(opts.lista ?? [recorrente()]),
      findUnique: jest.fn().mockResolvedValue(recorrente()),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        atualizacoes.push(data);
        return data;
      }),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
      delete: jest.fn(),
    },
  };

  const contasPagar = {
    criarDespesa: jest.fn(async () => {
      if (opts.erroAoCriar) throw new Error(opts.erroAoCriar);
      return { id: 'c1', idFnApagarIxc: 7777 };
    }),
  };

  const categorias = { classificar: jest.fn() };

  const service = new RecorrentesService(
    prisma as never,
    contasPagar as never,
    categorias as never,
  );
  return { service, prisma, contasPagar, categorias, atualizacoes };
}

describe('mesSeguinte', () => {
  it('mantém o dia do mês', () => {
    expect(mesSeguinte(new Date(Date.UTC(2026, 7, 20)))).toEqual(
      new Date(Date.UTC(2026, 8, 20)),
    );
  });

  it('dia 31 em mês de 30 cai no último dia — não vira dia 1º do outro mês', () => {
    // 31/01 + 1 mês = 28/02 (e não 03/03, que é o que o setMonth faria).
    expect(mesSeguinte(new Date(Date.UTC(2026, 0, 31)))).toEqual(
      new Date(Date.UTC(2026, 1, 28)),
    );
    // 31/03 → 30/04
    expect(mesSeguinte(new Date(Date.UTC(2026, 2, 31)))).toEqual(
      new Date(Date.UTC(2026, 3, 30)),
    );
  });

  it('atravessa a virada do ano', () => {
    expect(mesSeguinte(new Date(Date.UTC(2026, 11, 10)))).toEqual(
      new Date(Date.UTC(2027, 0, 10)),
    );
  });

  it('fevereiro de ano bissexto', () => {
    expect(mesSeguinte(new Date(Date.UTC(2028, 0, 31)))).toEqual(
      new Date(Date.UTC(2028, 1, 29)),
    );
  });
});

describe('RecorrentesService.gerarPendentes', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(HOJE);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('gera a conta quando entra na janela de antecedência', async () => {
    // Vence 20/08 com 5 dias de antecedência: nasce em 15/08, que é hoje.
    const { service, contasPagar } = montarServico();

    const r = await service.gerarPendentes('u1');

    expect(r.geradas).toBe(1);
    expect(contasPagar.criarDespesa).toHaveBeenCalledWith(
      expect.objectContaining({
        idFornecedorIxc: 196,
        valor: 1200,
        observacao: 'Link de internet',
        dataVencimento: new Date(Date.UTC(2026, 7, 20)),
      }),
      'u1',
    );
  });

  it('não gera antes da hora', async () => {
    const { service, contasPagar } = montarServico({
      // Vence 30/08: com 5 dias, só nasce em 25/08.
      lista: [recorrente({ proximoVencimento: new Date(Date.UTC(2026, 7, 30)) })],
    });

    const r = await service.gerarPendentes();

    expect(r.geradas).toBe(0);
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('desligada não gera', async () => {
    const { service, contasPagar } = montarServico({ lista: [] });

    await service.gerarPendentes();

    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('atrasada gera na primeira rodada seguinte', async () => {
    const { service } = montarServico({
      // Devia ter nascido em 05/08 e não nasceu (IXC fora do ar, por exemplo).
      lista: [recorrente({ proximoVencimento: new Date(Date.UTC(2026, 7, 10)) })],
    });

    expect((await service.gerarPendentes()).geradas).toBe(1);
  });

  it('depois de gerar, o vencimento anda um mês', async () => {
    const { service, atualizacoes } = montarServico();

    await service.gerarPendentes();

    expect(atualizacoes[0]).toMatchObject({
      proximoVencimento: new Date(Date.UTC(2026, 8, 20)),
      ultimoErro: null,
    });
  });

  it('se a criação falha, o vencimento NÃO anda e o erro fica gravado', async () => {
    const { service, atualizacoes } = montarServico({
      erroAoCriar: 'IXC recusou: fornecedor inválido',
    });

    const r = await service.gerarPendentes();

    expect(r.geradas).toBe(0);
    expect(r.erros[0]).toMatchObject({ fornecedor: 'Provedor de Link' });
    // Só o erro é gravado — o mês continua pendente para a próxima rodada.
    expect(atualizacoes[0]).toEqual({
      ultimoErro: 'IXC recusou: fornecedor inválido',
    });
  });

  it('uma que falha não impede as outras', async () => {
    const { service } = montarServico({
      lista: [recorrente({ id: 'r1' }), recorrente({ id: 'r2' })],
    });

    expect((await service.gerarPendentes()).geradas).toBe(2);
  });

  it('aplica a categoria ao título que o IXC devolveu', async () => {
    const { service, categorias } = montarServico({
      lista: [recorrente({ categoriaId: 'cat-1' })],
    });

    await service.gerarPendentes('u1');

    expect(categorias.classificar).toHaveBeenCalledWith(7777, 'cat-1', 'u1');
  });
});
