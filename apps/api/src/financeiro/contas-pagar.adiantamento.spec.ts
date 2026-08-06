import { StatusContaPagar } from '@prisma/client';
import { montarSituacaoAdiantamento } from './contas-pagar.service';

const PAGO_EM = new Date('2026-07-25T12:00:00Z');

describe('montarSituacaoAdiantamento', () => {
  it('conta paga: dia 25 confirmado', () => {
    expect(
      montarSituacaoAdiantamento(800, true, {
        status: StatusContaPagar.PAGO,
        pago: true,
        pagoEm: PAGO_EM,
      }),
    ).toEqual({
      valor: 800,
      descontado: true,
      situacao: 'PAGO',
      status: StatusContaPagar.PAGO,
      pagoEm: PAGO_EM,
    });
  });

  it('conta gerada mas sem retorno do banco: pendente', () => {
    const s = montarSituacaoAdiantamento(800, true, {
      status: StatusContaPagar.AGUARDANDO_PAGAMENTO,
      pago: false,
      pagoEm: null,
    });
    expect(s.situacao).toBe('PENDENTE');
    expect(s.pagoEm).toBeNull();
  });

  it('sem conta do dia 25: não gerado', () => {
    expect(montarSituacaoAdiantamento(800, true, null)).toMatchObject({
      situacao: 'NAO_GERADO',
      status: null,
    });
  });

  it('conta cancelada conta como não gerada (não há o que descontar)', () => {
    const s = montarSituacaoAdiantamento(800, true, {
      status: StatusContaPagar.CANCELADO,
      pago: false,
      pagoEm: null,
    });
    expect(s.situacao).toBe('NAO_GERADO');
    // O status cru fica disponível para a tela explicar o motivo.
    expect(s.status).toBe(StatusContaPagar.CANCELADO);
  });

  it('CLT: valor apurado aparece, mas não foi descontado do salário', () => {
    expect(
      montarSituacaoAdiantamento(800, false, null).descontado,
    ).toBe(false);
  });
});
