import {
  consolidarDadosBancarios,
  detectarCampoFornecedor,
  detectarCampoIcms,
  distribuicaoIcms,
  ehIcmsIsento,
  filtrarFuncionariosIsentos,
  mapFornecedorParaFuncionario,
  mapLinhaDadosBancarios,
  montarUpdateDoFornecedor,
  parseValoresIsento,
  somenteDigitos,
} from './ixc.fornecedor';
import type { IxcFornecedor } from './ixc.types';

const HENRICO: IxcFornecedor = {
  id: '2672',
  ativo: 'S',
  tipo_pessoa: 'F',
  razao: 'Henrico Santos Sousa',
  cnpj_cpf: '082.935.753-01',
  contribuinte_icms: 'I',
  celular: '75999998888',
  cidade: '3',
  banco: '001',
  agencia: '1234',
  conta: '56789-0',
  chave_pix: 'henrico@pix',
};

const ACME: IxcFornecedor = {
  id: '900',
  ativo: 'S',
  tipo_pessoa: 'J',
  razao: 'ACME Telecom LTDA',
  cnpj_cpf: '12.345.678/0001-00',
  contribuinte_icms: 'S',
};

describe('detectarCampoIcms', () => {
  it('prefere o campo que fala de contribuinte', () => {
    expect(
      detectarCampoIcms([{ aliquota_icms: '18', contribuinte_icms: 'I' }]),
    ).toBe('contribuinte_icms');
  });

  it('aceita variações de nome', () => {
    expect(detectarCampoIcms([{ icms: 'I' }])).toBe('icms');
    expect(detectarCampoIcms([{ icms_contribuinte: 'I' }])).toBe(
      'icms_contribuinte',
    );
  });

  it('retorna null quando nenhum campo menciona ICMS', () => {
    expect(detectarCampoIcms([{ razao: 'ACME' }])).toBeNull();
  });
});

describe('ehIcmsIsento', () => {
  it('reconhece texto com "isent" independente da configuração', () => {
    expect(ehIcmsIsento('Isento', [])).toBe(true);
    expect(ehIcmsIsento('ISENTO DE ICMS', ['I'])).toBe(true);
  });

  it('usa os valores configurados para códigos', () => {
    expect(ehIcmsIsento('I', ['I', 'ISENTO'])).toBe(true);
    expect(ehIcmsIsento('2', ['I', 'ISENTO'])).toBe(false);
    expect(ehIcmsIsento('2', ['2'])).toBe(true);
  });

  it('vazio nunca é isento', () => {
    expect(ehIcmsIsento('', ['I'])).toBe(false);
  });
});

describe('parseValoresIsento', () => {
  it('separa por vírgula, ponto e vírgula ou espaço', () => {
    expect(parseValoresIsento('i; 2 , isento')).toEqual(['I', '2', 'ISENTO']);
  });

  it('cai no padrão textual quando vazio', () => {
    expect(parseValoresIsento('')).toEqual(['I', 'ISENTO']);
    expect(parseValoresIsento(null)).toEqual(['I', 'ISENTO']);
  });
});

describe('mapFornecedorParaFuncionario', () => {
  it('traz cadastro e dados de pagamento', () => {
    const f = mapFornecedorParaFuncionario(HENRICO, 'I')!;
    expect(f.idFornecedor).toBe(2672);
    expect(f.nome).toBe('Henrico Santos Sousa');
    expect(f.cpfCnpj).toBe('082.935.753-01');
    expect(f.telefone).toBe('75999998888');
    expect(f.cidadeIxc).toBe(3);
    expect(f.banco).toBe('001');
    expect(f.agencia).toBe('1234');
    expect(f.conta).toBe('56789-0');
    expect(f.chavePix).toBe('henrico@pix');
  });

  it('aceita cpf_cnpj e cai na fantasia quando não há razão', () => {
    const f = mapFornecedorParaFuncionario({
      id: '10',
      fantasia: 'Zé da Silva',
      cpf_cnpj: '11122233344',
    })!;
    expect(f.nome).toBe('Zé da Silva');
    expect(f.cpfCnpj).toBe('11122233344');
  });

  it('ignora registro sem id válido', () => {
    expect(mapFornecedorParaFuncionario({ id: '0', razao: 'X' })).toBeNull();
  });
});

describe('filtrarFuncionariosIsentos', () => {
  it('seleciona só os fornecedores com ICMS isento', () => {
    const { campoIcms, funcionarios } = filtrarFuncionariosIsentos([
      HENRICO,
      ACME,
    ]);
    expect(campoIcms).toBe('contribuinte_icms');
    expect(funcionarios.map((f) => f.idFornecedor)).toEqual([2672]);
  });

  it('respeita o campo e os valores informados', () => {
    const registros: IxcFornecedor[] = [
      { id: '1', razao: 'A', icms_situacao: '3' },
      { id: '2', razao: 'B', icms_situacao: '1' },
    ];
    const { funcionarios } = filtrarFuncionariosIsentos(registros, {
      campoIcms: 'icms_situacao',
      valoresIsento: ['3'],
    });
    expect(funcionarios.map((f) => f.nome)).toEqual(['A']);
  });

  it('não seleciona ninguém quando o campo não existe', () => {
    const { campoIcms, funcionarios } = filtrarFuncionariosIsentos([
      { id: '1', razao: 'A' },
    ]);
    expect(campoIcms).toBeNull();
    expect(funcionarios).toEqual([]);
  });
});

describe('distribuicaoIcms', () => {
  it('conta os valores encontrados, do mais comum ao menos', () => {
    const dist = distribuicaoIcms(
      [ACME, HENRICO, { id: '3', razao: 'C', contribuinte_icms: 'S' }],
      'contribuinte_icms',
    );
    expect(dist).toEqual([
      { valor: 'S', quantidade: 2, exemplos: ['ACME Telecom LTDA', 'C'] },
      { valor: 'I', quantidade: 1, exemplos: ['Henrico Santos Sousa'] },
    ]);
  });

  it('agrupa vazios quando não há campo de ICMS', () => {
    const dist = distribuicaoIcms([{ id: '1', razao: 'A' }], null);
    expect(dist[0]).toMatchObject({ valor: '(vazio)', quantidade: 1 });
  });
});

describe('montarUpdateDoFornecedor', () => {
  const dados = mapFornecedorParaFuncionario(HENRICO, 'I')!;

  it('vincula o fornecedor e atualiza os dados de pagamento', () => {
    const update = montarUpdateDoFornecedor(
      {
        id: 'local-1',
        ixcId: 16,
        nome: 'HENRICO',
        cpfCnpj: '082.935.753-01',
        email: null,
        telefone: null,
        cidadeIxc: null,
        idFornecedorIxc: null,
      },
      dados,
    );
    expect(update.idFornecedorIxc).toBe(2672);
    expect(update.chavePix).toBe('henrico@pix');
    expect(update.banco).toBe('001');
    expect(update.telefone).toBe('75999998888');
    // Veio da tabela `funcionarios` (tem ixcId): não sobrescreve o nome.
    expect('nome' in update).toBe(false);
  });

  it('deixa o fornecedor mandar no cadastro de quem veio dele', () => {
    const update = montarUpdateDoFornecedor(
      {
        id: 'local-2',
        ixcId: null,
        nome: 'Nome antigo',
        cpfCnpj: '082.935.753-01',
        email: 'antigo@x.com',
        telefone: '7500000000',
        cidadeIxc: 3,
        idFornecedorIxc: 2672,
      },
      dados,
    );
    expect(update.nome).toBe('Henrico Santos Sousa');
    expect(update.telefone).toBe('75999998888');
    expect('idFornecedorIxc' in update).toBe(false);
    expect('cidadeIxc' in update).toBe(false);
  });

  it('não apaga dado local quando o fornecedor não informa', () => {
    const update = montarUpdateDoFornecedor(
      {
        id: 'local-3',
        ixcId: 20,
        nome: 'Maria',
        cpfCnpj: '11122233344',
        email: 'maria@x.com',
        telefone: '7511112222',
        cidadeIxc: 1,
        idFornecedorIxc: 30,
      },
      mapFornecedorParaFuncionario({ id: '30', razao: 'Maria' })!,
    );
    expect(update).toEqual({});
  });
});

describe('dados bancários (aba do fornecedor)', () => {
  // Colunas do grid: ID, Código do banco, Banco, Código da agência, Código da
  // conta, Tipo conta, Titular, CNPJ/CPF, Pix CPF/CNPJ, Pix celular, Pix e-mail.
  const LINHA = {
    id: '6',
    id_fornecedor: '2672',
    codigo_banco: '',
    banco: 'Banco Inter',
    codigo_agencia: '',
    codigo_conta: '',
    tipo_conta: 'Corrente',
    titular: 'Henrico Santos Sousa',
    pix_cpf_cnpj: '',
    pix_celular: '(99) 98107-4450',
    pix_email: '',
  };

  it('lê banco e a chave PIX da coluna preenchida', () => {
    expect(mapLinhaDadosBancarios(LINHA)).toEqual({
      banco: 'Banco Inter',
      agencia: null,
      conta: null,
      chavePix: '(99) 98107-4450',
    });
  });

  it('não confunde "Tipo conta" com o número da conta', () => {
    expect(mapLinhaDadosBancarios(LINHA).conta).toBeNull();
  });

  it('prefere a linha que tem PIX e completa com as demais', () => {
    const consolidado = consolidarDadosBancarios([
      { id: '1', banco: 'Bradesco', agencia: '1234', conta: '5678' },
      { id: '2', banco: 'Banco Inter', pix_email: 'ana@pix' },
    ]);
    expect(consolidado).toEqual({
      banco: 'Banco Inter',
      agencia: '1234',
      conta: '5678',
      chavePix: 'ana@pix',
    });
  });

  it('acha o vínculo com o fornecedor', () => {
    expect(detectarCampoFornecedor(LINHA)).toBe('id_fornecedor');
    expect(detectarCampoFornecedor({ id: '1', id_cadastro: '9' })).toBe(
      'id_cadastro',
    );
  });
});

describe('somenteDigitos', () => {
  it('normaliza CPF/CNPJ formatado', () => {
    expect(somenteDigitos('082.935.753-01')).toBe('08293575301');
    expect(somenteDigitos(null)).toBe('');
  });
});
