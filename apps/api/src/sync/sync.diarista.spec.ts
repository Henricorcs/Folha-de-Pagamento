import type { IxcFornecedor } from '../ixc/ixc.types';
import { SyncService } from './sync.service';

/**
 * O que importa aqui: a importação nunca pode piorar o cadastro. Não duplica
 * pessoa, não desfaz correção feita à mão, não traz quem já é funcionário, e
 * não troca o vínculo com o fornecedor — é ele que decide contra qual cadastro
 * do IXC a conta a pagar é lançada.
 */
const DEDA: IxcFornecedor = {
  id: '3103',
  ativo: 'S',
  tipo_pessoa: 'E',
  razao: 'Antonio Clebes Alves da Silva',
  fantasia: 'Deda pedreiro',
  cnpj_cpf: '038.957.603-40',
  contribuinte_icms: 'N',
};

const MARIA_FISICA: IxcFornecedor = {
  id: '2672',
  ativo: 'S',
  tipo_pessoa: 'F',
  razao: 'Maria Souza',
  cnpj_cpf: '111.222.333-44',
  contribuinte_icms: 'I',
};

const ACME: IxcFornecedor = {
  id: '900',
  ativo: 'S',
  tipo_pessoa: 'J',
  razao: 'ACME Telecom LTDA',
  cnpj_cpf: '12.345.678/0001-00',
};

function montarServico(opts: {
  fornecedores?: IxcFornecedor[];
  diaristas?: Array<Record<string, unknown>>;
  funcionarios?: Array<Record<string, unknown>>;
  config?: Record<string, unknown>;
  banco?: Record<number, Record<string, string | null>>;
}) {
  const listAll = jest
    .fn()
    .mockResolvedValue(opts.fornecedores ?? [DEDA, MARIA_FISICA, ACME]);
  const ixc = { listAll } as any;

  const dadosBancarios = {
    tabelaEmUso: 'fornecedor_dados_bancarios',
    doFornecedor: jest.fn(
      async (id: number) =>
        opts.banco?.[id] ?? {
          banco: null,
          agencia: null,
          conta: null,
          chavePix: null,
          tipoChavePix: null,
        },
    ),
  } as any;

  const create = jest
    .fn()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: `novo-${String(data.idFornecedorIxc)}`,
      ...data,
    }));
  const update = jest.fn().mockResolvedValue({});

  const prisma = {
    syncLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    funcionario: {
      // Respeita o filtro: "estar na tabela" e "ser funcionário" (isento de
      // ICMS) são coisas diferentes, e é justamente isso que se testa aqui.
      findMany: jest.fn(
        async (args?: { where?: { isentoIcms?: boolean } }) => {
          const todos = opts.funcionarios ?? [];
          return args?.where?.isentoIcms
            ? todos.filter((f) => f.isentoIcms === true)
            : todos;
        },
      ),
    },
    diarista: {
      findMany: jest.fn().mockResolvedValue(opts.diaristas ?? []),
      create,
      update,
    },
  } as any;

  const config = {
    obter: jest.fn().mockResolvedValue({
      fornecedorCampoTipoPessoa: '',
      fornecedorTipoEstrangeiro: 'E,ESTRANGEIRO',
      fornecedorTabelaBanco: '',
      ...opts.config,
    }),
  } as any;

  return {
    service: new SyncService(ixc, prisma, config, dadosBancarios),
    listAll,
    create,
    update,
    dadosBancarios,
    prisma,
  };
}

/** Cadastro local em branco, com só o que o índice e o update olham. */
function diaristaLocal(over: Record<string, unknown> = {}) {
  return {
    id: 'local-1',
    nome: 'Deda',
    nomeFantasia: null,
    cpfCnpj: null,
    telefone: null,
    banco: null,
    agencia: null,
    conta: null,
    chavePix: null,
    cidadeIxc: null,
    idFornecedorIxc: null,
    ...over,
  };
}

describe('SyncService.syncDiaristasDoFornecedor', () => {
  it('importa só quem é Estrangeiro, ignorando física e jurídica', async () => {
    const { service, listAll, create } = montarServico({});

    const res = await service.syncDiaristasDoFornecedor();

    expect(listAll).toHaveBeenCalledWith(
      'fornecedor',
      expect.objectContaining({ qtype: 'fornecedor.ativo', query: 'S' }),
    );
    expect(res).toMatchObject({
      recurso: 'diaristas',
      totalLidos: 1,
      totalNovos: 1,
      totalAtualizados: 0,
      campoTipoPessoa: 'tipo_pessoa',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      idFornecedorIxc: 3103,
      nome: 'Antonio Clebes Alves da Silva',
      nomeFantasia: 'Deda pedreiro',
      cpfCnpj: '038.957.603-40',
      importadoDoIxc: true,
    });
  });

  it('traz a chave PIX da aba "Dados bancários" do fornecedor', async () => {
    const { service, create, dadosBancarios } = montarServico({
      fornecedores: [DEDA],
      banco: {
        3103: {
          banco: 'Banco Inter',
          agencia: '0001',
          conta: '12345-6',
          chavePix: '(99) 98107-4450',
          tipoChavePix: 'Celular',
        },
      },
    });

    await service.syncDiaristasDoFornecedor();

    expect(dadosBancarios.doFornecedor).toHaveBeenCalledWith(3103, '');
    expect(create.mock.calls[0][0].data).toMatchObject({
      banco: 'Banco Inter',
      agencia: '0001',
      conta: '12345-6',
      chavePix: '(99) 98107-4450',
      tipoChavePix: 'Celular',
    });
  });

  it('não importa quem já está cadastrado como funcionário', async () => {
    const { service, create, update } = montarServico({
      fornecedores: [DEDA],
      funcionarios: [
        {
          id: 'func-1',
          ixcId: null,
          nome: 'Antonio Clebes Alves da Silva',
          cpfCnpj: '03895760340', // sem máscara: casa pelos dígitos
          email: null,
          telefone: null,
          cidadeIxc: null,
          idFornecedorIxc: null,
          isentoIcms: true,
        },
      ],
    });

    const res = await service.syncDiaristasDoFornecedor();

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(res.totalNovos).toBe(0);
    expect(res.ignoradosPorSerFuncionario).toEqual([
      'Antonio Clebes Alves da Silva',
    ]);
  });

  /**
   * A tabela `funcionarios` guarda também quem veio do cadastro de
   * funcionários do IXC sem ser isento de ICMS — e isento é o que define ser
   * funcionário nesta casa. Confundir "estar na tabela" com "ser" barrava de
   * virar diarista quem está marcado "Estrangeiro" no fornecedor e
   * "Contribuinte ICMS: Sim", que é exatamente quem deve entrar.
   */
  it('quem está na tabela de funcionários sem ser isento de ICMS vira diarista', async () => {
    const { service, create } = montarServico({
      fornecedores: [DEDA],
      funcionarios: [
        {
          id: 'func-1',
          ixcId: 77,
          nome: 'Antonio Clebes Alves da Silva',
          cpfCnpj: '03895760340',
          email: null,
          telefone: null,
          cidadeIxc: null,
          idFornecedorIxc: null,
          isentoIcms: false,
        },
      ],
    });

    const res = await service.syncDiaristasDoFornecedor();

    expect(res.ignoradosPorSerFuncionario).toEqual([]);
    expect(res.totalNovos).toBe(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nome: 'Antonio Clebes Alves da Silva',
          idFornecedorIxc: 3103,
          importadoDoIxc: true,
        }),
      }),
    );
  });

  it('casa por CPF com diarista já cadastrado à mão, sem duplicar', async () => {
    const { service, create, update } = montarServico({
      fornecedores: [DEDA],
      diaristas: [diaristaLocal({ cpfCnpj: '03895760340' })],
    });

    const res = await service.syncDiaristasDoFornecedor();

    expect(create).not.toHaveBeenCalled();
    expect(res.totalAtualizados).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'local-1' },
      data: expect.objectContaining({
        idFornecedorIxc: 3103,
        nomeFantasia: 'Deda pedreiro',
      }),
    });
  });

  it('não desfaz a chave PIX corrigida à mão', async () => {
    const { service, update } = montarServico({
      fornecedores: [DEDA],
      diaristas: [
        diaristaLocal({ idFornecedorIxc: 3103, chavePix: 'corrigido@pix' }),
      ],
      banco: {
        3103: {
          banco: null,
          agencia: null,
          conta: null,
          chavePix: 'antigo@pix',
          tipoChavePix: 'E-mail',
        },
      },
    });

    await service.syncDiaristasDoFornecedor();

    expect('chavePix' in update.mock.calls[0][0].data).toBe(false);
  });

  it('rodar de novo não cria ninguém e não troca o vínculo', async () => {
    const { service, create, update } = montarServico({
      fornecedores: [DEDA],
      diaristas: [
        diaristaLocal({
          idFornecedorIxc: 3103,
          nomeFantasia: 'Deda pedreiro',
          cpfCnpj: '038.957.603-40',
        }),
      ],
    });

    const res = await service.syncDiaristasDoFornecedor();

    expect(create).not.toHaveBeenCalled();
    expect(res.totalAtualizados).toBe(1);
    expect(update.mock.calls[0][0].data).toEqual({});
  });

  it('CPF vazio no IXC não faz duas pessoas virarem uma só', async () => {
    const semDoc = [
      { id: '10', ativo: 'S', tipo_pessoa: 'E', razao: 'Um', cnpj_cpf: '' },
      { id: '11', ativo: 'S', tipo_pessoa: 'E', razao: 'Dois', cnpj_cpf: '' },
    ];
    const { service, create } = montarServico({ fornecedores: semDoc });

    const res = await service.syncDiaristasDoFornecedor();

    expect(res.totalNovos).toBe(2);
    expect(create.mock.calls.map((c) => c[0].data.nome)).toEqual(['Um', 'Dois']);
  });

  it('dois fornecedores com o mesmo CPF não fazem o vínculo oscilar', async () => {
    const gemeos = [
      DEDA,
      { ...DEDA, id: '4000', razao: 'Antonio C. A. da Silva' },
    ];
    const { service, create, update } = montarServico({
      fornecedores: gemeos,
      diaristas: [
        diaristaLocal({ idFornecedorIxc: 3103, cpfCnpj: '038.957.603-40' }),
      ],
    });

    const res = await service.syncDiaristasDoFornecedor();

    // O segundo casa com o mesmo local: é pulado em vez de sobrescrever.
    expect(res.totalAtualizados).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect('idFornecedorIxc' in update.mock.calls[0][0].data).toBe(false);
  });

  it('código de estrangeiro diferente do configurado não importa ninguém', async () => {
    const { service, create } = montarServico({
      config: { fornecedorTipoEstrangeiro: '3' },
    });

    const res = await service.syncDiaristasDoFornecedor();

    expect(create).not.toHaveBeenCalled();
    expect(res.totalLidos).toBe(0);
  });
});

describe('SyncService.previewDiaristasDoFornecedor', () => {
  it('mostra campo, distribuição e quem já está cadastrado ou é funcionário', async () => {
    const { service } = montarServico({
      diaristas: [diaristaLocal({ idFornecedorIxc: 3103 })],
      funcionarios: [
        {
          id: 'func-1',
          ixcId: null,
          nome: 'Maria Souza',
          cpfCnpj: '11122233344',
          email: null,
          telefone: null,
          cidadeIxc: null,
          idFornecedorIxc: 2672,
        },
      ],
    });

    const preview = await service.previewDiaristasDoFornecedor();

    expect(preview.campoTipoPessoa).toBe('tipo_pessoa');
    expect(preview.valoresEstrangeiro).toEqual(['E', 'ESTRANGEIRO']);
    expect(preview.totalFornecedoresAtivos).toBe(3);
    expect(preview.distribuicao.map((d) => d.valor).sort()).toEqual([
      'E',
      'F',
      'J',
    ]);
    expect(preview.camposDisponiveis).toContain('tipo_pessoa');
    expect(
      preview.diaristas.map((d) => [
        d.nome,
        d.jaCadastrado,
        d.jaEhFuncionario,
      ]),
    ).toEqual([['Antonio Clebes Alves da Silva', true, false]]);
  });

  it('não grava nada', async () => {
    const { service, create, update } = montarServico({});
    await service.previewDiaristasDoFornecedor();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
