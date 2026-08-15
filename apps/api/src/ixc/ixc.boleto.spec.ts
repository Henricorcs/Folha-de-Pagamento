import {
  buildContaPagarPayload,
  pareceCodigoDeBoleto,
  somenteDigitosDoBoleto,
} from './ixc.financeiro';

/**
 * O código do boleto é o que o IXC usa para pagá-lo. O que este arquivo
 * protege:
 *
 *  - o código chega ao IXC só com dígitos, que é como ele guarda — boleto
 *    copiado vem cheio de ponto, espaço e máscara do banco;
 *  - os três tamanhos válidos passam (44 do código de barras, 47 da cobrança,
 *    48 das contas de consumo) e o resto é barrado antes de virar título;
 *  - conta sem boleto continua saindo com o campo vazio, e não com lixo.
 */

const BASE = {
  idFornecedor: 55,
  valor: 123.54,
  contaPagamentoId: 18,
  contaContabilId: 324,
  filialId: 1,
  dataEmissao: new Date(Date.UTC(2026, 7, 15)),
  dataVencimento: new Date(Date.UTC(2026, 7, 20)),
  observacao: 'energia da fazenda',
};

describe('somenteDigitosDoBoleto', () => {
  it('tira a máscara que vem colada do banco', () => {
    expect(
      somenteDigitosDoBoleto('34191.79001 01043.510047 91020.150008 1 96610000012345'),
    ).toBe('34191790010104351004791020150008196610000012345');
  });

  it('vazio continua vazio, e não vira "null"', () => {
    expect(somenteDigitosDoBoleto(null)).toBe('');
    expect(somenteDigitosDoBoleto(undefined)).toBe('');
    expect(somenteDigitosDoBoleto('')).toBe('');
  });
});

describe('pareceCodigoDeBoleto', () => {
  it('aceita os três tamanhos que existem', () => {
    expect(pareceCodigoDeBoleto('1'.repeat(44))).toBe(true); // código de barras
    expect(pareceCodigoDeBoleto('1'.repeat(47))).toBe(true); // linha digitável
    expect(pareceCodigoDeBoleto('1'.repeat(48))).toBe(true); // contas de consumo
  });

  it('recusa o que ficou pela metade', () => {
    // O caso real: copiar só o primeiro campo da linha digitável.
    expect(pareceCodigoDeBoleto('1'.repeat(11))).toBe(false);
    expect(pareceCodigoDeBoleto('1'.repeat(46))).toBe(false);
    expect(pareceCodigoDeBoleto('')).toBe(false);
  });
});

describe('buildContaPagarPayload com boleto', () => {
  it('manda o código só com dígitos', () => {
    const body = buildContaPagarPayload({
      ...BASE,
      tipoPagamento: 'Boleto',
      codigoBarras: '34191.79001 01043.510047 91020.150008 1 96610000012345',
    });

    expect(body).toMatchObject({
      tipo_pagamento: 'Boleto',
      codigo_barras: '34191790010104351004791020150008196610000012345',
    });
  });

  it('leva documento e número da nota quando existem', () => {
    const body = buildContaPagarPayload({
      ...BASE,
      documento: 'NF 1234',
      numeroNota: '1234',
    });

    expect(body).toMatchObject({ documento: 'NF 1234', numero_nota: '1234' });
  });

  it('sem boleto, os campos vão vazios', () => {
    const body = buildContaPagarPayload(BASE);

    expect(body).toMatchObject({
      codigo_barras: '',
      documento: '',
      numero_nota: '',
    });
  });
});
