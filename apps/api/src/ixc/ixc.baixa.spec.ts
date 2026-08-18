import {
  buildBaixaContaPagarPayload,
  codigoTipoPagamentoBaixa,
  montarHistoricoBaixa,
  semAcento,
} from './ixc.financeiro';

/**
 * Uma baixa feita daqui tem de chegar ao IXC igual à que se faria na tela dele.
 * "Igual" não é figura de linguagem: é o mesmo corpo, campo por campo, como a
 * coleção oficial documenta em Sistema > Pagar > Botões > Baixa manual (Pagar).
 *
 * O que motivou este arquivo foi um pagamento que constava pago no título e não
 * aparecia para conciliar com o extrato. A causa estava num campo só — ver
 * `codigoTipoPagamentoBaixa`.
 */

describe('codigoTipoPagamentoBaixa', () => {
  it('PIX vira "X" — e não dinheiro, que era o que saía antes', () => {
    expect(codigoTipoPagamentoBaixa('Pix', false)).toBe('X');
    expect(codigoTipoPagamentoBaixa('PIX', false)).toBe('X');
  });

  it('dinheiro vira "D"', () => {
    expect(codigoTipoPagamentoBaixa('Dinheiro', true)).toBe('D');
    expect(codigoTipoPagamentoBaixa('Espécie', true)).toBe('D');
  });

  it('transferência, TED, boleto e cartão viram "T"', () => {
    for (const rotulo of ['Transferência', 'TED', 'DOC', 'Boleto', 'Cartão']) {
      expect(codigoTipoPagamentoBaixa(rotulo, false)).toBe('T');
    }
  });

  it('sem rótulo, quem decide é de onde o dinheiro saiu', () => {
    // Do caixa é dinheiro; de conta bancária é movimento de banco, e é isso
    // que o põe na conciliação.
    expect(codigoTipoPagamentoBaixa(null, true)).toBe('D');
    expect(codigoTipoPagamentoBaixa('', false)).toBe('T');
    expect(codigoTipoPagamentoBaixa('qualquer coisa', false)).toBe('T');
  });
});

describe('montarHistoricoBaixa', () => {
  it('escreve como o IXC escreve: "Pag. <quem> - doc.: <documento>"', () => {
    expect(
      montarHistoricoBaixa({
        beneficiario: 'Gilvan Pereira da Costa',
        documento: '36716',
      }),
    ).toBe('Pag. Gilvan Pereira da Costa - doc.: 36716');
  });

  it('sem documento, fica só quem recebeu', () => {
    expect(montarHistoricoBaixa({ beneficiario: 'Gilvan' })).toBe('Pag. Gilvan');
  });

  it('sem nome nenhum, não inventa: só o documento', () => {
    expect(montarHistoricoBaixa({ documento: '99' })).toBe('Pag. - doc.: 99');
  });

  it('sai sem acento — o IXC grava o nosso UTF-8 como Latin-1', () => {
    // "José" virava "JosÃ©" na tela do IXC, e o travessão virava "?".
    expect(
      montarHistoricoBaixa({ beneficiario: 'José Antônio — Ltda', documento: '1' }),
    ).toBe('Pag. Jose Antonio Ltda - doc.: 1');
  });
});

describe('semAcento', () => {
  it('tira acento e troca o que o Latin-1 não escreve', () => {
    expect(semAcento('lançamento')).toBe('lancamento');
    expect(semAcento('a — b')).toBe('a b');
  });
});

describe('buildBaixaContaPagarPayload', () => {
  const base = {
    idFnApagar: 37019,
    contaPagamentoId: 18,
    contaPagamentoNome: 'Conta ModoBank PIX',
    contaContabilId: 324,
    filialId: 1,
    filialNome: 'Filial (Alterar)',
    valor: 167,
    data: new Date(Date.UTC(2026, 7, 8)),
    documento: '37019',
    tipoPagamento: 'X',
    historico: 'Pag. Gilvan Pereira da Costa - doc.: 37019',
  };

  it('leva os mesmos campos que a tela do IXC manda', () => {
    // A lista sai do exemplo oficial da coleção. Campo a menos aqui é campo
    // que a baixa feita daqui deixa de preencher lá.
    const esperados = [
      'id_pagar',
      'id_pagar_label',
      'filial',
      'filial_label',
      'filial_id',
      'conta_',
      'conta__label',
      'id_conta',
      'id_conta_class_finan_a',
      'id_conta_class_finan_a_label',
      'tipo_pagamento',
      'chave_pix',
      'cheque_banco',
      'cheque_numero',
      'cheque_nome',
      'cheque_predatado',
      'data',
      'documento',
      'pdesconto',
      'vdesconto',
      'pacrescimo',
      'vacrescimo',
      'valor_parcela',
      'debito',
      'valor_total_pago',
      'historico',
      'tipo_p',
      'tipo_lanc',
      'id_operador',
    ];
    const payload = buildBaixaContaPagarPayload(base);
    for (const campo of esperados) {
      expect(Object.keys(payload)).toContain(campo);
    }
  });

  it('manda o rótulo da conta junto do id, como todo campo de seleção de lá', () => {
    const payload = buildBaixaContaPagarPayload(base);
    expect(payload.conta_).toBe(18);
    expect(payload.conta__label).toBe('Conta ModoBank PIX');
  });

  it('a forma de pagamento vai como veio, sem cair no dinheiro', () => {
    expect(buildBaixaContaPagarPayload(base).tipo_pagamento).toBe('X');
  });

  it('sem rótulo de conta, o campo vai vazio em vez de sumir', () => {
    const { contaPagamentoNome: _, filialNome: __, ...semNomes } = base;
    const payload = buildBaixaContaPagarPayload(semNomes);
    expect(payload.conta__label).toBe('');
    expect(payload.filial_label).toBe('');
  });

  it('valores com vírgula decimal, que é o que a baixa aceita', () => {
    const payload = buildBaixaContaPagarPayload({ ...base, valor: 1234.5 });
    expect(payload.valor_parcela).toBe('1234,50');
    expect(payload.debito).toBe('1234,50');
    expect(payload.valor_total_pago).toBe('1234,50');
  });

  it('a data vai no dia informado, não no dia do registro', () => {
    expect(buildBaixaContaPagarPayload(base).data).toBe('08/08/2026');
  });
});
