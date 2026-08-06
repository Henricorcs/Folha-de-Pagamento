import type { IxcFornecedor } from '../ixc/ixc.types';
import { SyncService } from './sync.service';

/** Fornecedores devolvidos pelo IXC no cenário padrão. */
const FORNECEDORES: IxcFornecedor[] = [
  {
    id: '2672',
    ativo: 'S',
    razao: 'Henrico Santos Sousa',
    cnpj_cpf: '082.935.753-01',
    contribuinte_icms: 'I',
    chave_pix: 'henrico@pix',
    banco: '001',
  },
  {
    id: '900',
    ativo: 'S',
    razao: 'ACME Telecom LTDA',
    cnpj_cpf: '12.345.678/0001-00',
    contribuinte_icms: 'S',
  },
  {
    id: '3010',
    ativo: 'S',
    razao: 'Maria Souza',
    cnpj_cpf: '11122233344',
    contribuinte_icms: 'Isento',
    chave_pix: '11122233344',
  },
];

function montarServico(opts: {
  fornecedores?: IxcFornecedor[];
  locais?: Array<Record<string, unknown>>;
  config?: Record<string, unknown>;
}) {
  const listAll = jest.fn().mockResolvedValue(opts.fornecedores ?? FORNECEDORES);
  const ixc = { listAll } as any;

  const create = jest
    .fn()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: `novo-${String(data.idFornecedorIxc)}`,
      ixcId: null,
      cidadeIxc: null,
      ...data,
    }));
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    syncLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    funcionario: {
      findMany: jest.fn().mockResolvedValue(opts.locais ?? []),
      create,
      update,
    },
  } as any;

  const config = {
    obter: jest.fn().mockResolvedValue({
      fornecedorCampoIcms: '',
      fornecedorIcmsIsento: 'I,ISENTO',
      ...opts.config,
    }),
  } as any;

  return {
    service: new SyncService(ixc, prisma, config),
    listAll,
    create,
    update,
    prisma,
  };
}

describe('SyncService.syncFuncionariosDoFornecedor', () => {
  it('lista só fornecedores ativos e importa apenas os isentos de ICMS', async () => {
    const { service, listAll, create } = montarServico({});

    const res = await service.syncFuncionariosDoFornecedor();

    expect(listAll).toHaveBeenCalledWith(
      'fornecedor',
      expect.objectContaining({ qtype: 'fornecedor.ativo', query: 'S' }),
    );
    expect(res).toEqual({
      recurso: 'fornecedores',
      totalLidos: 2,
      totalNovos: 2,
      totalAtualizados: 0,
    });

    const nomes = create.mock.calls.map((c) => c[0].data.nome);
    expect(nomes).toEqual(['Henrico Santos Sousa', 'Maria Souza']);
    expect(create.mock.calls[0][0].data).toMatchObject({
      idFornecedorIxc: 2672,
      chavePix: 'henrico@pix',
      banco: '001',
      ativo: true,
    });
  });

  it('casa por CPF com funcionário já existente e vincula o fornecedor', async () => {
    const { service, create, update } = montarServico({
      locais: [
        {
          id: 'local-1',
          ixcId: 16,
          nome: 'HENRICO',
          cpfCnpj: '08293575301', // sem máscara: casa pelos dígitos
          email: null,
          telefone: null,
          cidadeIxc: null,
          idFornecedorIxc: null,
        },
      ],
    });

    const res = await service.syncFuncionariosDoFornecedor();

    expect(res.totalNovos).toBe(1); // só a Maria
    expect(res.totalAtualizados).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'local-1' },
      data: expect.objectContaining({
        idFornecedorIxc: 2672,
        chavePix: 'henrico@pix',
      }),
    });
  });

  it('não duplica quando o vínculo por id de fornecedor já existe', async () => {
    const { service, create, update } = montarServico({
      fornecedores: [FORNECEDORES[0]],
      locais: [
        {
          id: 'local-1',
          ixcId: null,
          nome: 'Henrico Santos Sousa',
          cpfCnpj: null,
          email: null,
          telefone: null,
          cidadeIxc: null,
          idFornecedorIxc: 2672,
        },
      ],
    });

    const res = await service.syncFuncionariosDoFornecedor();

    expect(create).not.toHaveBeenCalled();
    expect(res.totalAtualizados).toBe(1);
    // Preenche o CPF que faltava no cadastro local.
    expect(update.mock.calls[0][0].data).toMatchObject({
      cpfCnpj: '082.935.753-01',
    });
  });

  it('não importa nada quando o código de isento configurado não bate', async () => {
    const { service, create } = montarServico({
      config: { fornecedorIcmsIsento: '2' },
      fornecedores: [FORNECEDORES[0], FORNECEDORES[1]],
    });

    const res = await service.syncFuncionariosDoFornecedor();

    expect(create).not.toHaveBeenCalled();
    expect(res.totalLidos).toBe(0);
  });
});

describe('SyncService.previewFuncionariosDoFornecedor', () => {
  it('mostra campo detectado, distribuição e quem já está cadastrado', async () => {
    const { service } = montarServico({
      locais: [
        {
          id: 'local-1',
          ixcId: null,
          nome: 'Maria Souza',
          cpfCnpj: '111.222.333-44',
          email: null,
          telefone: null,
          cidadeIxc: null,
          idFornecedorIxc: null,
        },
      ],
    });

    const preview = await service.previewFuncionariosDoFornecedor();

    expect(preview.campoIcms).toBe('contribuinte_icms');
    expect(preview.valoresIsento).toEqual(['I', 'ISENTO']);
    expect(preview.totalFornecedoresAtivos).toBe(3);
    expect(preview.distribuicao.map((d) => d.valor).sort()).toEqual([
      'I',
      'ISENTO',
      'S',
    ]);
    expect(
      preview.funcionarios.map((f) => [f.nome, f.jaCadastrado]),
    ).toEqual([
      ['Henrico Santos Sousa', false],
      ['Maria Souza', true],
    ]);
  });
});
