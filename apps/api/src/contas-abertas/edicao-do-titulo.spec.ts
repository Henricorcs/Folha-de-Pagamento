import { montarEdicao } from './pagamentos.service';

/**
 * Editar um título é um `PUT`, e o `PUT` do webservice reescreve a linha
 * inteira. O que este arquivo protege:
 *
 *  - o que não foi alterado vai de volta igual — mandar só o campo mudado
 *    apagaria fornecedor, valor e vencimento de uma vez;
 *  - as datas voltam no formato que o IXC aceita (ele devolve AAAA-MM-DD na
 *    leitura e só aceita DD/MM/AAAA na escrita);
 *  - `liberado` e `previsao` não são mexidos: são eles que fazem a conta
 *    existir para o financeiro de lá.
 */

const ATUAL = {
  id: '4242',
  id_fornecedor: '196',
  data_emissao: '2026-08-15',
  data_vencimento: '2026-09-14',
  valor: '125.00',
  id_contas: '18',
  id_conta: '324',
  filial_id: '1',
  tipo_pagamento: 'Pix',
  chave_pix: '617.696.563-24',
  codigo_barras: '',
  documento: 'NF 99',
  numero_nota: '99',
  obs: 'Teste (2/4)',
  previsao: 'N',
  liberado: 'S',
};

describe('montarEdicao', () => {
  it('devolve o registro inteiro quando muda só o tipo de pagamento', async () => {
    const p = await montarEdicao(ATUAL, { tipoPagamento: 'Boleto' });

    expect(p).toMatchObject({
      tipo_pagamento: 'Boleto',
      // Tudo o mais volta como estava — é isto que o PUT exige.
      id_fornecedor: '196',
      valor: '125.00',
      data_vencimento: '14/09/2026',
      id_contas: '18',
      id_conta: '324',
      obs: 'Teste (2/4)',
      documento: 'NF 99',
      numero_nota: '99',
      chave_pix: '617.696.563-24',
    });
  });

  it('converte as datas para o formato que o IXC aceita', async () => {
    const p = await montarEdicao(ATUAL, { dataVencimento: '2026-12-01' });

    expect(p.data_vencimento).toBe('01/12/2026');
    expect(p.data_emissao).toBe('15/08/2026');
  });

  it('não mexe no que faz a conta existir para o IXC', async () => {
    const p = await montarEdicao(ATUAL, { valor: 200 });

    expect(p).toMatchObject({ liberado: 'S', previsao: 'N', valor: '200.00' });
  });

  it('boleto vai só com dígitos', async () => {
    const p = await montarEdicao(ATUAL, {
      tipoPagamento: 'Boleto',
      codigoBarras: '23791.14206 90000.088246 16001.444005 1 15650000008998',
    });

    expect(p.codigo_barras).toBe(
      '23791142069000008824616001444005115650000008998',
    );
  });

  it('registro que já veio com data brasileira não é remexido', async () => {
    const p = await montarEdicao(
      { ...ATUAL, data_vencimento: '14/09/2026' },
      { observacao: 'nova' },
    );

    expect(p.data_vencimento).toBe('14/09/2026');
    expect(p.obs).toBe('nova');
  });
});
