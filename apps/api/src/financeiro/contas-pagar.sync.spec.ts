import { StatusContaPagar } from '@prisma/client';
import { statusPeloIxc, type SituacaoNoIxc } from './contas-pagar.service';

const ixc = (over: Partial<SituacaoNoIxc> = {}): SituacaoNoIxc => ({
  pago: false,
  cancelada: false,
  auditoria: null,
  ...over,
});

describe('statusPeloIxc', () => {
  it('banco confirmou: vira paga', () => {
    expect(
      statusPeloIxc(StatusContaPagar.AGUARDANDO_PAGAMENTO, ixc({ pago: true })),
    ).toBe(StatusContaPagar.PAGO);
  });

  it('já paga aqui e lá: nada muda', () => {
    expect(statusPeloIxc(StatusContaPagar.PAGO, ixc({ pago: true }))).toBeNull();
  });

  it('reprovada na tela do IXC: aparece reprovada aqui', () => {
    expect(
      statusPeloIxc(StatusContaPagar.AGUARDANDO_PAGAMENTO, ixc({ auditoria: 'R' })),
    ).toBe(StatusContaPagar.REPROVADO);
  });

  it('liberada na tela do IXC: volta a aguardar pagamento', () => {
    expect(
      statusPeloIxc(StatusContaPagar.REPROVADO, ixc({ auditoria: 'A' })),
    ).toBe(StatusContaPagar.AGUARDANDO_PAGAMENTO);
  });

  it('aprovada lá e aqui: nada muda', () => {
    expect(
      statusPeloIxc(StatusContaPagar.AGUARDANDO_PAGAMENTO, ixc({ auditoria: 'A' })),
    ).toBeNull();
  });

  it('cancelada no IXC (pela auditoria ou pela conta)', () => {
    expect(
      statusPeloIxc(StatusContaPagar.AGUARDANDO_APROVACAO, ixc({ auditoria: 'C' })),
    ).toBe(StatusContaPagar.CANCELADO);
    expect(
      statusPeloIxc(StatusContaPagar.AGUARDANDO_PAGAMENTO, ixc({ cancelada: true })),
    ).toBe(StatusContaPagar.CANCELADO);
  });

  it('pagamento vence a auditoria', () => {
    expect(
      statusPeloIxc(
        StatusContaPagar.REPROVADO,
        ixc({ pago: true, auditoria: 'R' }),
      ),
    ).toBe(StatusContaPagar.PAGO);
  });

  it('paga aqui, sem notícia de pagamento lá: não rebaixa', () => {
    expect(statusPeloIxc(StatusContaPagar.PAGO, ixc({ auditoria: 'A' }))).toBeNull();
  });

  it('sem notícia da auditoria: preserva o status local', () => {
    expect(statusPeloIxc(StatusContaPagar.AGUARDANDO_APROVACAO, ixc())).toBeNull();
    expect(statusPeloIxc(StatusContaPagar.REPROVADO, ixc())).toBeNull();
  });
});
