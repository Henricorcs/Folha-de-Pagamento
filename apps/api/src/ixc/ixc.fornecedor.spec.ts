import {
  casaValor,
  consolidarDadosBancarios,
  destinoDaChavePix,
  detectarCampo,
  detectarCampoFornecedor,
  detectarCampoTipoPix,
  distribuicaoDoCampo,
  escolherPix,
  filtrarFornecedores,
  lerTipoPixPreferencial,
  mapFornecedorParaPessoa,
  mapLinhaDadosBancarios,
  montarUpdateDiaristaDoFornecedor,
  montarUpdateDoFornecedor,
  parseValores,
  REGRA_ESTRANGEIRO,
  REGRA_ICMS_ISENTO,
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

/** O diarista do exemplo real: razão social formal, fantasia é como o chamam. */
const DEDA: IxcFornecedor = {
  id: '3103',
  ativo: 'S',
  tipo_pessoa: 'E',
  razao: 'Antonio Clebes Alves da Silva',
  fantasia: 'Deda pedreiro',
  cnpj_cpf: '038.957.603-40',
  contribuinte_icms: 'N',
};

describe('detectarCampo (ICMS)', () => {
  it('prefere o campo que fala de contribuinte', () => {
    expect(
      detectarCampo(
        [{ aliquota_icms: '18', contribuinte_icms: 'I' }],
        REGRA_ICMS_ISENTO,
      ),
    ).toBe('contribuinte_icms');
  });

  it('aceita variações de nome', () => {
    expect(detectarCampo([{ icms: 'I' }], REGRA_ICMS_ISENTO)).toBe('icms');
    expect(
      detectarCampo([{ icms_contribuinte: 'I' }], REGRA_ICMS_ISENTO),
    ).toBe('icms_contribuinte');
  });

  it('retorna null quando nenhum campo menciona ICMS', () => {
    expect(detectarCampo([{ razao: 'ACME' }], REGRA_ICMS_ISENTO)).toBeNull();
  });
});

describe('detectarCampo (tipo de pessoa)', () => {
  it('acha a coluna padrão do tipo de pessoa', () => {
    expect(detectarCampo([DEDA], REGRA_ESTRANGEIRO)).toBe('tipo_pessoa');
  });

  it('acha uma coluna própria de estrangeiro, se a base usar isso', () => {
    expect(
      detectarCampo([{ id: '1', pessoa_estrangeira: 'S' }], REGRA_ESTRANGEIRO),
    ).toBe('pessoa_estrangeira');
  });

  it('tipo_pessoa vence outra coluna que também fale de pessoa', () => {
    expect(
      detectarCampo(
        [{ id: '1', id_pessoa_contato: '9', tipo_pessoa: 'E' }],
        REGRA_ESTRANGEIRO,
      ),
    ).toBe('tipo_pessoa');
  });

  it('retorna null quando a base não tem nada parecido', () => {
    expect(detectarCampo([{ id: '1', razao: 'A' }], REGRA_ESTRANGEIRO)).toBeNull();
  });
});

describe('casaValor', () => {
  it('reconhece texto com "isent" independente da configuração', () => {
    expect(casaValor('Isento', [], REGRA_ICMS_ISENTO)).toBe(true);
    expect(casaValor('ISENTO DE ICMS', ['I'], REGRA_ICMS_ISENTO)).toBe(true);
  });

  it('reconhece "estrangeiro" por extenso', () => {
    expect(casaValor('Estrangeiro', [], REGRA_ESTRANGEIRO)).toBe(true);
  });

  it('usa os valores configurados para códigos', () => {
    expect(casaValor('I', ['I', 'ISENTO'], REGRA_ICMS_ISENTO)).toBe(true);
    expect(casaValor('2', ['I', 'ISENTO'], REGRA_ICMS_ISENTO)).toBe(false);
    expect(casaValor('2', ['2'], REGRA_ICMS_ISENTO)).toBe(true);
  });

  it('nunca confunde física e jurídica com estrangeiro', () => {
    const valores = REGRA_ESTRANGEIRO.padrao;
    expect(casaValor('F', valores, REGRA_ESTRANGEIRO)).toBe(false);
    expect(casaValor('J', valores, REGRA_ESTRANGEIRO)).toBe(false);
    expect(casaValor('E', valores, REGRA_ESTRANGEIRO)).toBe(true);
  });

  it('vazio nunca casa', () => {
    expect(casaValor('', ['I'], REGRA_ICMS_ISENTO)).toBe(false);
    expect(casaValor('', ['E'], REGRA_ESTRANGEIRO)).toBe(false);
  });
});

describe('parseValores', () => {
  it('separa por vírgula, ponto e vírgula ou espaço', () => {
    expect(parseValores('i; 2 , isento', REGRA_ICMS_ISENTO)).toEqual([
      'I',
      '2',
      'ISENTO',
    ]);
  });

  it('cai no padrão da regra quando vazio', () => {
    expect(parseValores('', REGRA_ICMS_ISENTO)).toEqual(['I', 'ISENTO']);
    expect(parseValores(null, REGRA_ICMS_ISENTO)).toEqual(['I', 'ISENTO']);
    expect(parseValores('', REGRA_ESTRANGEIRO)).toEqual(['E', 'ESTRANGEIRO']);
  });
});

describe('mapFornecedorParaPessoa', () => {
  it('traz cadastro e dados de pagamento', () => {
    const f = mapFornecedorParaPessoa(HENRICO, 'I')!;
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

  it('guarda a fantasia separada da razão social', () => {
    const d = mapFornecedorParaPessoa(DEDA, 'E')!;
    expect(d.nome).toBe('Antonio Clebes Alves da Silva');
    expect(d.nomeFantasia).toBe('Deda pedreiro');
  });

  it('aceita cpf_cnpj e cai na fantasia quando não há razão', () => {
    const f = mapFornecedorParaPessoa({
      id: '10',
      fantasia: 'Zé da Silva',
      cpf_cnpj: '11122233344',
    })!;
    expect(f.nome).toBe('Zé da Silva');
    expect(f.cpfCnpj).toBe('11122233344');
  });

  it('ignora registro sem id válido', () => {
    expect(mapFornecedorParaPessoa({ id: '0', razao: 'X' })).toBeNull();
  });
});

describe('filtrarFornecedores', () => {
  it('seleciona só os fornecedores com ICMS isento', () => {
    const { campo, pessoas } = filtrarFornecedores(
      [HENRICO, ACME],
      REGRA_ICMS_ISENTO,
    );
    expect(campo).toBe('contribuinte_icms');
    expect(pessoas.map((f) => f.idFornecedor)).toEqual([2672]);
  });

  it('seleciona só os estrangeiros, deixando física e jurídica de fora', () => {
    const { campo, pessoas } = filtrarFornecedores(
      [HENRICO, ACME, DEDA],
      REGRA_ESTRANGEIRO,
    );
    expect(campo).toBe('tipo_pessoa');
    expect(pessoas.map((p) => p.idFornecedor)).toEqual([3103]);
  });

  it('respeita o campo e os valores informados', () => {
    const registros: IxcFornecedor[] = [
      { id: '1', razao: 'A', icms_situacao: '3' },
      { id: '2', razao: 'B', icms_situacao: '1' },
    ];
    const { pessoas } = filtrarFornecedores(registros, REGRA_ICMS_ISENTO, {
      campo: 'icms_situacao',
      valores: ['3'],
    });
    expect(pessoas.map((f) => f.nome)).toEqual(['A']);
  });

  it('não seleciona ninguém quando o campo não existe', () => {
    const { campo, pessoas } = filtrarFornecedores(
      [{ id: '1', razao: 'A' }],
      REGRA_ICMS_ISENTO,
    );
    expect(campo).toBeNull();
    expect(pessoas).toEqual([]);
  });

  it('código de estrangeiro diferente do padrão: importa zero, não importa errado', () => {
    // Base que usa "3" para estrangeiro e ninguém configurou: melhor vazio do
    // que trazer a base inteira como diarista.
    const { pessoas } = filtrarFornecedores(
      [{ id: '1', razao: 'A', tipo_pessoa: '3' }],
      REGRA_ESTRANGEIRO,
    );
    expect(pessoas).toEqual([]);
  });
});

describe('distribuicaoDoCampo', () => {
  it('conta os valores encontrados, do mais comum ao menos', () => {
    const dist = distribuicaoDoCampo(
      [ACME, HENRICO, { id: '3', razao: 'C', contribuinte_icms: 'S' }],
      'contribuinte_icms',
    );
    expect(dist).toEqual([
      { valor: 'S', quantidade: 2, exemplos: ['ACME Telecom LTDA', 'C'] },
      { valor: 'I', quantidade: 1, exemplos: ['Henrico Santos Sousa'] },
    ]);
  });

  it('agrupa vazios quando não há campo', () => {
    const dist = distribuicaoDoCampo([{ id: '1', razao: 'A' }], null);
    expect(dist[0]).toMatchObject({ valor: '(vazio)', quantidade: 1 });
  });
});

describe('montarUpdateDiaristaDoFornecedor', () => {
  const dados = mapFornecedorParaPessoa(DEDA, 'E')!;
  const VAZIO = {
    id: 'd1',
    nome: '',
    nomeFantasia: null,
    cpfCnpj: null,
    telefone: null,
    banco: null,
    agencia: null,
    conta: null,
    chavePix: null,
    cidadeIxc: null,
    idFornecedorIxc: null,
  };

  it('preenche o cadastro vazio e vincula o fornecedor', () => {
    const update = montarUpdateDiaristaDoFornecedor(VAZIO, dados);
    expect(update.idFornecedorIxc).toBe(3103);
    expect(update.nome).toBe('Antonio Clebes Alves da Silva');
    expect(update.nomeFantasia).toBe('Deda pedreiro');
    expect(update.cpfCnpj).toBe('038.957.603-40');
  });

  it('não desfaz o que já está escrito aqui', () => {
    const update = montarUpdateDiaristaDoFornecedor(
      {
        ...VAZIO,
        nome: 'Deda',
        nomeFantasia: 'Deda pedreiro',
        cpfCnpj: '038.957.603-40',
        chavePix: 'corrigido@pix',
        idFornecedorIxc: 3103,
      },
      { ...dados, chavePix: 'antigo@pix', tipoChavePix: 'E-mail' },
    );
    expect(update).toEqual({});
  });

  it('nunca troca um vínculo de fornecedor já existente', () => {
    const update = montarUpdateDiaristaDoFornecedor(
      { ...VAZIO, idFornecedorIxc: 999 },
      dados,
    );
    expect('idFornecedorIxc' in update).toBe(false);
  });

  it('a chave PIX leva junto o tipo dela', () => {
    const update = montarUpdateDiaristaDoFornecedor(VAZIO, {
      ...dados,
      chavePix: '(99) 98107-4450',
      tipoChavePix: 'Celular',
    });
    expect(update.chavePix).toBe('(99) 98107-4450');
    expect(update.tipoChavePix).toBe('Celular');
  });
});

describe('montarUpdateDoFornecedor', () => {
  const dados = mapFornecedorParaPessoa(HENRICO, 'I')!;

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
      mapFornecedorParaPessoa({ id: '30', razao: 'Maria' })!,
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

  it('lê banco e a chave PIX da coluna preenchida, com o tipo dela', () => {
    expect(mapLinhaDadosBancarios(LINHA)).toEqual({
      banco: 'Banco Inter',
      agencia: null,
      conta: null,
      chavePix: '(99) 98107-4450',
      tipoChavePix: 'Celular',
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
      tipoChavePix: 'E-mail',
    });
  });

  it('acha o vínculo com o fornecedor', () => {
    expect(detectarCampoFornecedor(LINHA)).toBe('id_fornecedor');
    expect(detectarCampoFornecedor({ id: '1', id_cadastro: '9' })).toBe(
      'id_cadastro',
    );
  });
});

describe('tipo de PIX preferencial', () => {
  /** Linha com as três chaves preenchidas: só o preferencial desempata. */
  const COMPLETA = {
    id: '7',
    id_fornecedor: '2672',
    pix_cpf_cnpj: '082.935.753-01',
    pix_celular: '(99) 98107-4450',
    pix_email: 'henrico@pix.com',
  };

  it('usa a chave do tipo preferencial do cadastro', () => {
    expect(escolherPix({ ...COMPLETA, tipo_pix: 'E-mail' })).toEqual({
      chavePix: 'henrico@pix.com',
      tipoChavePix: 'E-mail',
    });
    expect(escolherPix({ ...COMPLETA, tipo_pix: 'Celular' })).toEqual({
      chavePix: '(99) 98107-4450',
      tipoChavePix: 'Celular',
    });
    expect(escolherPix({ ...COMPLETA, pix_preferencial: 'CPF/CNPJ' })).toEqual({
      chavePix: '082.935.753-01',
      tipoChavePix: 'CPF/CNPJ',
    });
  });

  it('acha a coluna do tipo mesmo com outro nome', () => {
    expect(detectarCampoTipoPix({ tipo_chave_pix_pref: 'Celular' })).toBe(
      'tipo_chave_pix_pref',
    );
    expect(lerTipoPixPreferencial({ pix_tipo_preferencial: 'celular' })).toBe(
      'Celular',
    );
    expect(lerTipoPixPreferencial({ banco: 'Inter' })).toBeNull();
  });

  it('ignora código de uma letra: "C" tanto é celular quanto CPF', () => {
    expect(lerTipoPixPreferencial({ tipo_pix: 'C' })).toBeNull();
    // Sem tipo legível, decide a coluna preenchida.
    expect(escolherPix({ tipo_pix: 'C', pix_email: 'ana@pix' })).toEqual({
      chavePix: 'ana@pix',
      tipoChavePix: 'E-mail',
    });
  });

  it('cai na chave preenchida quando o tipo preferencial está vazio no grid', () => {
    // Preferencial diz "Celular", mas a coluna do celular está em branco:
    // mandar tipo Celular com chave de e-mail o banco recusa.
    expect(
      escolherPix({
        tipo_pix: 'Celular',
        pix_celular: '',
        pix_email: 'ana@pix',
      }),
    ).toEqual({ chavePix: 'ana@pix', tipoChavePix: 'E-mail' });
  });

  it('nunca confunde a coluna do tipo com uma chave', () => {
    expect(escolherPix({ tipo_pix: 'Celular' })).toEqual({
      chavePix: null,
      tipoChavePix: null,
    });
  });

  it('leva o tipo junto da chave para o cadastro local', () => {
    const dados = mapFornecedorParaPessoa(HENRICO, 'I')!;
    dados.chavePix = '(99) 98107-4450';
    dados.tipoChavePix = 'Celular';
    const update = montarUpdateDoFornecedor(
      {
        id: 'local-1',
        ixcId: 16,
        nome: 'Henrico',
        cpfCnpj: '082.935.753-01',
        email: null,
        telefone: null,
        cidadeIxc: null,
        idFornecedorIxc: 2672,
      },
      dados,
    );
    expect(update.chavePix).toBe('(99) 98107-4450');
    expect(update.tipoChavePix).toBe('Celular');
  });
});

describe('somenteDigitos', () => {
  it('normaliza CPF/CNPJ formatado', () => {
    expect(somenteDigitos('082.935.753-01')).toBe('08293575301');
    expect(somenteDigitos(null)).toBe('');
  });
});

/**
 * Onde a chave PIX é gravada de volta no IXC. A coluna carrega o tipo da chave
 * — `pix_celular` é celular, `pix_email` é e-mail —, e o banco recusa quando o
 * par não bate. Escrever na coluna errada é pior do que não escrever: cria uma
 * chave falsa no cadastro que só se descobre com o pagamento recusado.
 */
describe('destinoDaChavePix', () => {
  const GRID = {
    id: '1',
    id_fornecedor: '14',
    banco: null,
    agencia: null,
    conta: null,
    pix_cpf_cnpj: null,
    pix_email: null,
    pix_celular: null,
    tipo_pix_preferencial: null,
  };

  it('escreve na coluna do tipo da chave', () => {
    expect(destinoDaChavePix(GRID, 'Celular')).toEqual({
      campoChave: 'pix_celular',
      campoTipo: 'tipo_pix_preferencial',
    });
    expect(destinoDaChavePix(GRID, 'E-mail')?.campoChave).toBe('pix_email');
    expect(destinoDaChavePix(GRID, 'CPF/CNPJ')?.campoChave).toBe('pix_cpf_cnpj');
  });

  /** Base que guarda tudo numa coluna só: aí ela serve para qualquer tipo. */
  it('cai na coluna genérica quando a base não separa por tipo', () => {
    const simples = { id: '1', id_fornecedor: '14', chave_pix: null };
    expect(destinoDaChavePix(simples, 'Celular')).toEqual({
      campoChave: 'chave_pix',
      campoTipo: null,
    });
  });

  /** Sem coluna para aquele tipo, desiste — não improvisa outra. */
  it('desiste quando não há coluna para o tipo', () => {
    const soEmail = { id: '1', id_fornecedor: '14', pix_email: null };
    expect(destinoDaChavePix(soEmail, 'Celular')).toBeNull();
  });

  it('sem tipo definido, usa a coluna genérica', () => {
    const misto = { id: '1', chave_pix: null, pix_celular: null };
    expect(destinoDaChavePix(misto, null)?.campoChave).toBe('chave_pix');
  });
});
