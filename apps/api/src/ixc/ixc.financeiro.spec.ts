import {
  buildAuditoriaPayload,
  buildContaPagarPayload,
  buildFornecedorPayload,
  formatDataIxc,
  formatValorIxc,
  lerSituacaoContaPagar,
} from './ixc.financeiro';

describe('formatDataIxc / formatValorIxc', () => {
  it('formata data como DD/MM/AAAA (UTC)', () => {
    expect(formatDataIxc(new Date(Date.UTC(2026, 6, 21)))).toBe('21/07/2026');
    expect(formatDataIxc(new Date(Date.UTC(2025, 0, 5)))).toBe('05/01/2025');
  });
  it('formata valor com 2 casas e ponto decimal', () => {
    expect(formatValorIxc(1234.5)).toBe('1234.50');
    expect(formatValorIxc(1270.8)).toBe('1270.80');
    expect(formatValorIxc(0.1 + 0.2)).toBe('0.30');
  });
});

describe('buildContaPagarPayload', () => {
  it('mapeia conta de pagamento, conta contábil, filial e datas', () => {
    const hoje = new Date(Date.UTC(2026, 6, 21));
    const body = buildContaPagarPayload({
      idFornecedor: 55,
      valor: 1270.8,
      contaPagamentoId: 18,
      contaContabilId: 2420,
      filialId: 1,
      dataEmissao: hoje,
      dataVencimento: hoje,
      observacao: 'saldo salarial referente ao mês 07/2026',
    });
    expect(body).toMatchObject({
      id_fornecedor: '55',
      id_contas: '18', // conta de pagamento
      id_conta: '2420', // conta contábil
      filial_id: '1',
      valor: '1270.80',
      data_emissao: '21/07/2026',
      data_vencimento: '21/07/2026',
      previsao: 'N',
      liberado: 'S',
      obs: 'saldo salarial referente ao mês 07/2026',
    });
  });
});

describe('buildAuditoriaPayload', () => {
  it('monta aprovação (A) com id do fn_apagar', () => {
    const body = buildAuditoriaPayload({
      idFnApagar: 3000,
      status: 'A',
      motivo: 'Aprovado via app',
    });
    expect(body).toMatchObject({
      status: 'A',
      id_fn_apagar: '3000',
      tipo: 'E',
      motivo: 'Aprovado via app',
    });
  });
});

describe('buildFornecedorPayload', () => {
  it('cria pessoa física por padrão com cidade obrigatória', () => {
    const body = buildFornecedorPayload({ nome: 'João Patrocínio', cidadeId: 1 });
    expect(body).toMatchObject({
      ativo: 'S',
      tipo_pessoa: 'F',
      razao: 'João Patrocínio',
      cidade: '1',
    });
  });
});

describe('lerSituacaoContaPagar', () => {
  it('detecta pago quando há data de pagamento', () => {
    const s = lerSituacaoContaPagar({
      valor: '1000.00',
      valor_aberto: '0.00',
      valor_total_pago: '1000.00',
      data_pagamento: '2026-07-21',
      status_auditoria: 'A',
    });
    expect(s.pago).toBe(true);
    expect(s.statusAuditoria).toBe('A');
  });
  it('não considera pago quando ainda há valor aberto', () => {
    const s = lerSituacaoContaPagar({
      valor: '1000.00',
      valor_aberto: '1000.00',
      valor_total_pago: '0',
      status_auditoria: '',
    });
    expect(s.pago).toBe(false);
    expect(s.statusAuditoria).toBeNull();
  });
});
