import { StatusContaPagar, TipoLancamento } from '@prisma/client';
import { ContasPagarService } from './contas-pagar.service';

/**
 * Ações em massa: o ponto delicado é uma conta que falha não levar as outras
 * junto — o lote é uma ida ao IXC por conta, e a tela precisa saber quem ficou
 * de fora.
 */
const CONTAS: Record<string, Record<string, unknown>> = {
  ok1: {
    id: 'ok1',
    beneficiarioNome: 'Henrico Santos',
    status: StatusContaPagar.AGUARDANDO_APROVACAO,
    tipo: TipoLancamento.SALARIO,
    competencia: '2026-08',
    funcionarioId: 'f1',
    idFnApagarIxc: 3001,
  },
  ok2: {
    id: 'ok2',
    beneficiarioNome: 'Maria Souza',
    status: StatusContaPagar.AGUARDANDO_APROVACAO,
    tipo: TipoLancamento.ADIANTAMENTO,
    competencia: '2026-08',
    funcionarioId: 'f2',
    idFnApagarIxc: 3002,
  },
  paga: {
    id: 'paga',
    beneficiarioNome: 'José Pago',
    status: StatusContaPagar.PAGO,
    tipo: TipoLancamento.SALARIO,
    competencia: '2026-07',
    funcionarioId: 'f3',
    idFnApagarIxc: 3003,
  },
  semIxc: {
    id: 'semIxc',
    beneficiarioNome: 'Ana Rascunho',
    status: StatusContaPagar.RASCUNHO,
    tipo: TipoLancamento.AVULSO,
    competencia: null,
    funcionarioId: null,
    idFnApagarIxc: null,
  },
};

function montarServico() {
  const prisma = {
    contaPagar: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return CONTAS[where.id] ?? null;
      }),
      findMany: jest.fn(
        async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in
            .map((id) => CONTAS[id])
            .filter(Boolean)
            .map((c) => ({ id: c.id, beneficiarioNome: c.beneficiarioNome })),
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: object }) => ({
          ...CONTAS[where.id],
          ...data,
        }),
      ),
      delete: jest.fn().mockResolvedValue({}),
    },
  } as any;

  const ixc = {
    action: jest.fn().mockResolvedValue({ type: 'success' }),
    remove: jest.fn().mockResolvedValue({ type: 'success' }),
    getById: jest.fn().mockResolvedValue(null),
  } as any;

  const config = { obter: jest.fn().mockResolvedValue({}) } as any;
  const fornecedores = {} as any;
  const vales = {
    baixarNaFolha: jest.fn().mockResolvedValue(undefined),
    estornarBaixa: jest.fn().mockResolvedValue(undefined),
  } as any;

  return {
    service: new ContasPagarService(prisma, ixc, config, fornecedores, vales),
    prisma,
    ixc,
    vales,
  };
}

describe('aprovarEmLote / reprovarEmLote', () => {
  it('aprova o que dá e devolve quem ficou de fora, com o motivo', async () => {
    const { service, ixc } = montarServico();

    const r = await service.aprovarEmLote(
      ['ok1', 'paga', 'semIxc', 'ok2'],
      'Aprovado em lote',
    );

    expect(r.total).toBe(4);
    expect(r.sucesso).toBe(2);
    expect(r.falhas.map((f) => f.beneficiario)).toEqual([
      'José Pago',
      'Ana Rascunho',
    ]);
    expect(r.falhas[0].erro).toMatch(/já paga/i);
    expect(r.falhas[1].erro).toMatch(/ainda não existe no IXC/i);
    // Só as duas que deram certo viraram auditoria no IXC.
    expect(ixc.action).toHaveBeenCalledTimes(2);
  });

  it('conta id repetido uma vez só', async () => {
    const { service, ixc } = montarServico();
    const r = await service.aprovarEmLote(['ok1', 'ok1', 'ok1'], 'Aprovado');
    expect(r).toMatchObject({ total: 1, sucesso: 1, falhas: [] });
    expect(ixc.action).toHaveBeenCalledTimes(1);
  });

  it('reprovar em massa devolve as parcelas de vale ao saldo', async () => {
    const { service, vales } = montarServico();
    const r = await service.reprovarEmLote(['ok1', 'ok2'], 'Erro na folha');
    expect(r.sucesso).toBe(2);
    expect(vales.estornarBaixa).toHaveBeenCalledTimes(2);
  });
});

describe('removerEmLote', () => {
  it('apaga no IXC e aqui, pulando a que já foi paga', async () => {
    const { service, ixc, prisma } = montarServico();

    const r = await service.removerEmLote(['ok1', 'paga', 'semIxc']);

    expect(r).toMatchObject({ total: 3, sucesso: 2 });
    expect(r.falhas).toHaveLength(1);
    expect(r.falhas[0].beneficiario).toBe('José Pago');
    // A que nunca chegou ao IXC não tem fn_apagar para apagar lá.
    expect(ixc.remove).toHaveBeenCalledTimes(1);
    expect(ixc.remove).toHaveBeenCalledWith('fn_apagar', 3001);
    expect(prisma.contaPagar.delete).toHaveBeenCalledTimes(2);
  });

  it('IXC recusando a exclusão não apaga o registro daqui', async () => {
    const { service, ixc, prisma } = montarServico();
    ixc.remove.mockRejectedValue(new Error('fn_apagar em uso'));
    // A conta continua existindo lá: exclusão não pode ser só local.
    ixc.getById.mockResolvedValue({ id: '3001' });

    const r = await service.removerEmLote(['ok1']);

    expect(r).toMatchObject({ total: 1, sucesso: 0 });
    expect(r.falhas[0].erro).toMatch(/não apagou a conta/i);
    expect(prisma.contaPagar.delete).not.toHaveBeenCalled();
  });
});
