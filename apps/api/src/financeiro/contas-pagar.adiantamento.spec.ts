import { StatusContaPagar } from '@prisma/client';
import {
  montarContaJaGerada,
  montarSituacaoAdiantamento,
} from './contas-pagar.service';

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

describe('montarContaJaGerada', () => {
  it('sem conta na competência: nada a avisar', () => {
    expect(montarContaJaGerada(null)).toBeNull();
  });

  it('conta viva: avisa que gerar de novo duplica', () => {
    expect(
      montarContaJaGerada({
        status: StatusContaPagar.AGUARDANDO_PAGAMENTO,
        pago: false,
        pagoEm: null,
      }),
    ).toEqual({
      situacao: 'PENDENTE',
      status: StatusContaPagar.AGUARDANDO_PAGAMENTO,
      pagoEm: null,
    });
  });

  it('conta paga: avisa com a data', () => {
    const s = montarContaJaGerada({
      status: StatusContaPagar.PAGO,
      pago: true,
      pagoEm: PAGO_EM,
    })!;
    expect(s.situacao).toBe('PAGO');
    expect(s.pagoEm).toBe(PAGO_EM);
  });

  it('cancelada ou reprovada não conta: gerar de novo é o certo', () => {
    for (const status of [
      StatusContaPagar.CANCELADO,
      StatusContaPagar.REPROVADO,
    ]) {
      expect(
        montarContaJaGerada({ status, pago: false, pagoEm: null }),
      ).toBeNull();
    }
  });

  it('conta com erro ainda conta: o caminho é reenviar, não gerar de novo', () => {
    expect(
      montarContaJaGerada({
        status: StatusContaPagar.ERRO,
        pago: false,
        pagoEm: null,
      }),
    ).toMatchObject({ situacao: 'PENDENTE', status: StatusContaPagar.ERRO });
  });
});
