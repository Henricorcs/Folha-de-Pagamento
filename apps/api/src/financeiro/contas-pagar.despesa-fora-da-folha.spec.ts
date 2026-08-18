import { StatusContaPagar, TipoLancamento } from '@prisma/client';
import { ContasPagarService } from './contas-pagar.service';

/**
 * Despesa lançada à mão é conta da empresa, não pagamento a quem trabalha
 * nela. O que este arquivo protege:
 *
 *  - a tela de Pagamentos da folha não a mostra, nem quando alguém filtra por
 *    tipo — ela apareceu uma vez no meio das diárias e dos salários, e é dali
 *    que saem os relatórios do mês;
 *  - a conta nasce aprovada no IXC: criada por API ela vem sem auditoria, e o
 *    IXC só mostra para pagar o que passou por lá.
 */

function montarServico(
  opts: { idFnApagar?: number | null; erroNaAuditoria?: string } = {},
) {
  const idFnApagar = 'idFnApagar' in opts ? opts.idFnApagar : 9001;
  const contas = new Map<string, Record<string, unknown>>();

  const prisma = {
    contaPagar: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        contas.get(where.id),
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const conta = { id: 'c1', ...data, idFnApagarIxc: null };
        contas.set('c1', conta);
        return conta;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const atual = contas.get('c1') ?? {};
        const conta = { ...atual, ...data };
        contas.set('c1', conta);
        return conta;
      }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as never)),
  };

  const criados: string[] = [];
  const ixc = {
    create: jest.fn(async (recurso: string) => {
      criados.push(recurso);
      if (recurso === 'fn_apagar_auditoria' && opts.erroNaAuditoria) {
        throw new Error(opts.erroNaAuditoria);
      }
      return { id: recurso === 'fn_apagar' ? idFnApagar : 1, raw: {} };
    }),
    list: jest.fn().mockResolvedValue({ registros: [], total: 0, page: 1 }),
    getById: jest.fn().mockResolvedValue(null),
  };

  const config = {
    obter: jest.fn().mockResolvedValue({
      contaContabilAvulso: 324,
      contaPagamentoId: 18,
      contaPagamentoCaixaId: 23,
      filialId: 1,
      tipoPagamentoPadrao: 'Pix',
      fornecedorTabelaBanco: '',
      pixCampoTipoChave: '',
      pixCodigosTipoChave: '',
      pixCampoTipoChaveAprendido: '',
      pixCodigosTipoChaveAprendidos: '',
    }),
  };

  const fornecedores = { buscarNoIxcPorId: jest.fn().mockResolvedValue(null) };

  const service = new ContasPagarService(
    prisma as never,
    ixc as never,
    config as never,
    fornecedores as never,
    { acertosDaCompetencia: jest.fn() } as never,
  );

  return { service, prisma, ixc, criados, contas };
}

describe('a folha não mostra despesa lançada à mão', () => {
  it('a listagem exclui o tipo DESPESA', async () => {
    const { service, prisma } = montarServico();

    await service.listar({ page: 1, pageSize: 50 });

    const [{ where }] = prisma.contaPagar.findMany.mock.calls[0];
    expect(where.tipo).toEqual({ not: TipoLancamento.DESPESA });
  });

  it('filtrar por DESPESA não reabre a porta', async () => {
    const { service, prisma } = montarServico();

    await service.listar({ tipo: TipoLancamento.DESPESA, page: 1, pageSize: 50 });

    const [{ where }] = prisma.contaPagar.findMany.mock.calls[0];
    // Continua sendo o "diferente de", e não o filtro pedido.
    expect(where.tipo).toEqual({ not: TipoLancamento.DESPESA });
  });

  it('filtro por outro tipo continua valendo', async () => {
    const { service, prisma } = montarServico();

    await service.listar({ tipo: TipoLancamento.SALARIO, page: 1, pageSize: 50 });

    const [{ where }] = prisma.contaPagar.findMany.mock.calls[0];
    expect(where.tipo).toBe(TipoLancamento.SALARIO);
  });
});

/*
 * O outro lado da moeda: a folha esconde a despesa de propósito, e a lista de
 * contas em aberto é lida do IXC. A despesa que o IXC recusou não cabia em
 * nenhuma das duas — ficava gravada aqui, com o motivo, e invisível. Esta
 * consulta é a única que a mostra, e por isso o corte dela importa.
 */
describe('despesas que não chegaram ao IXC', () => {
  it('pede só despesa, sem número do IXC, parada em erro ou rascunho', async () => {
    const { service, prisma } = montarServico();

    await service.despesasNaoEnviadas();

    const [{ where, orderBy }] = prisma.contaPagar.findMany.mock.calls[0];
    expect(where).toEqual({
      tipo: TipoLancamento.DESPESA,
      idFnApagarIxc: null,
      status: {
        in: [StatusContaPagar.ERRO, StatusContaPagar.RASCUNHO],
      },
    });
    // A mais recente primeiro: é a que a pessoa acabou de tentar lançar.
    expect(orderBy).toEqual({ createdAt: 'desc' });
  });

  it('conta que chegou ao IXC não entra, nem estando em erro', async () => {
    const { service, prisma } = montarServico();

    await service.despesasNaoEnviadas();

    const [{ where }] = prisma.contaPagar.findMany.mock.calls[0];
    // O corte é o número do IXC, e não o status: erro depois do envio é outra
    // história, e aquela conta existe lá — mostrá-la aqui convidaria a
    // reenviar e duplicar.
    expect(where.idFnApagarIxc).toBeNull();
  });
});

describe('despesa nasce aprovada no IXC', () => {
  const dados = {
    idFornecedorIxc: 196,
    fornecedorNome: 'Marco Aurélio Castro',
    valor: 125,
    dataEmissao: new Date(Date.UTC(2026, 7, 15)),
    dataVencimento: new Date(Date.UTC(2026, 7, 15)),
    observacao: 'Teste (1/4)',
  };

  it('manda a conta e, logo depois, a aprovação', async () => {
    const { service, criados } = montarServico();

    const conta = await service.criarDespesa(dados, 'u1');

    expect(criados).toEqual(['fn_apagar', 'fn_apagar_auditoria']);
    expect(conta.status).toBe(StatusContaPagar.APROVADO);
    expect(conta.aprovadoEm).toBeInstanceOf(Date);
  });

  it('aprovação que falha não derruba a conta já criada', async () => {
    const { service } = montarServico({ erroNaAuditoria: 'IXC fora do ar' });

    const conta = await service.criarDespesa(dados);

    // A conta existe no IXC; o que falta é um clique em Aprovar na lista.
    expect(conta.idFnApagarIxc).toBe(9001);
    expect(conta.status).toBe(StatusContaPagar.AGUARDANDO_APROVACAO);
  });
});
