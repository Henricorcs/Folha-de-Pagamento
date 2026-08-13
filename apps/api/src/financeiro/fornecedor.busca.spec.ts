import { FornecedorService } from './fornecedor.service';

/**
 * "Conferir no IXC" antes de cadastrar um beneficiário.
 *
 * O IXC guarda o CPF/CNPJ **com pontos e hífen** e a busca dele é comparação de
 * texto pura. Quem digita só os dígitos ouvia "nenhum fornecedor com esse
 * documento" para gente que já era fornecedor lá — e criava um cadastro
 * duplicado, sem os dados bancários que estavam no antigo.
 *
 * O que este arquivo protege:
 *  - achar o cadastro esteja o documento digitado com máscara ou sem;
 *  - nunca vincular um fornecedor de outro documento (seria pagar outra pessoa);
 *  - o documento subir mascarado quando o fornecedor é criado daqui, para a
 *    próxima consulta achá-lo.
 */

/** Fornecedor como o IXC devolve: documento em `cpf_cnpj`, com máscara. */
const NO_IXC = {
  id: '3246',
  ativo: 'S',
  tipo_pessoa: 'F',
  razao: 'Marcos Vinicius de Teste',
  fantasia: 'Marcão',
  cpf_cnpj: '111.222.333-44',
  celular: '75999998888',
  cidade: '3',
};

const CFG = {
  cidadePadraoId: 1,
  fornecedorTabelaBanco: '',
};

/** Uma busca que o serviço mandou para o IXC. */
interface Chamada {
  qtype: string;
  query: string;
}

function montarServico(
  opts: {
    /** Como esta base responde cada busca. */
    responder?: (c: Chamada) => Record<string, unknown>[];
    /** Buscas que esta base recusa (coluna inexistente, IXC fora do ar). */
    recusar?: (c: Chamada) => boolean;
    /** Cadastro local do beneficiário, para o caminho de criação. */
    beneficiario?: Record<string, unknown>;
  } = {},
) {
  const chamadas: Chamada[] = [];
  const criados: Array<Record<string, unknown>> = [];

  const ixc = {
    list: jest.fn(
      async (
        _recurso: string,
        params: { qtype: string; query: string },
      ): Promise<{ total: number; page: number; registros: unknown[] }> => {
        const chamada = { qtype: params.qtype, query: params.query };
        chamadas.push(chamada);
        if (opts.recusar?.(chamada)) {
          throw new Error(`IXC (fornecedor): campo ${params.qtype} inválido`);
        }
        const registros = opts.responder?.(chamada) ?? [];
        return { total: registros.length, page: 1, registros };
      },
    ),
    create: jest.fn(async (_recurso: string, body: Record<string, unknown>) => {
      criados.push(body);
      return { id: 4100, raw: {} };
    }),
  };

  const prisma = {
    beneficiarioAvulso: {
      findUnique: jest.fn(async () => ({
        id: 'b1',
        nome: 'Marcos Vinicius de Teste',
        cpfCnpj: '11122233344',
        tipoPessoa: 'F',
        email: null,
        telefone: null,
        cidadeIxc: null,
        idFornecedorIxc: null,
        fornecedorNovoNoIxc: false,
        ...opts.beneficiario,
      })),
      update: jest.fn(async () => ({})),
    },
  };

  const config = { obter: jest.fn(async () => CFG) };
  const dadosBancarios = {
    doFornecedor: jest.fn(async () => ({
      banco: '001',
      agencia: '1234',
      conta: '56789-0',
      chavePix: 'marcao@pix',
      tipoChavePix: 'E-mail',
    })),
  };

  const service = new FornecedorService(
    prisma as never,
    ixc as never,
    config as never,
    dadosBancarios as never,
  );
  return { service, chamadas, criados, ixc };
}

/** Base que só conhece `cpf_cnpj` e só devolve o que está gravado com máscara. */
function baseComMascara(c: Chamada): Record<string, unknown>[] {
  if (c.qtype !== 'fornecedor.cpf_cnpj') return [];
  return c.query === NO_IXC.cpf_cnpj ? [NO_IXC] : [];
}

describe('procurarNoIxcPorCpfCnpj', () => {
  it('acha o cadastro mascarado quando o documento é digitado só com dígitos', async () => {
    const { service, chamadas } = montarServico({ responder: baseComMascara });

    const achado = await service.procurarNoIxcPorCpfCnpj('11122233344');

    expect(achado?.idFornecedor).toBe(3246);
    expect(achado?.nome).toBe('Marcos Vinicius de Teste');
    // Reusar só vale a pena trazendo o que o cadastro antigo já tem.
    expect(achado?.chavePix).toBe('marcao@pix');
    // A primeira tentativa já é o formato que o IXC guarda.
    expect(chamadas[0]).toEqual({
      qtype: 'fornecedor.cpf_cnpj',
      query: '111.222.333-44',
    });
  });

  it('acha também quando a base guardou o documento sem máscara', async () => {
    const semMascara = { ...NO_IXC, cpf_cnpj: '11122233344' };
    const { service } = montarServico({
      responder: (c) =>
        c.qtype === 'fornecedor.cpf_cnpj' && c.query === '11122233344'
          ? [semMascara]
          : [],
    });

    const achado = await service.procurarNoIxcPorCpfCnpj('111.222.333-44');

    expect(achado?.idFornecedor).toBe(3246);
  });

  it('tenta a outra coluna quando esta base não tem a documentada', async () => {
    const { service } = montarServico({
      recusar: (c) => c.qtype === 'fornecedor.cpf_cnpj',
      responder: (c) =>
        c.qtype === 'fornecedor.cnpj_cpf' && c.query === '111.222.333-44'
          ? [{ ...NO_IXC, cpf_cnpj: undefined, cnpj_cpf: '111.222.333-44' }]
          : [],
    });

    const achado = await service.procurarNoIxcPorCpfCnpj('11122233344');

    expect(achado?.idFornecedor).toBe(3246);
  });

  it('descarta registro de outro documento', async () => {
    // Base que ignora o filtro e devolve o primeiro fornecedor da tabela:
    // vincular esse cadastro seria pagar outra pessoa.
    const { service } = montarServico({ responder: () => [NO_IXC] });

    expect(await service.procurarNoIxcPorCpfCnpj('99988877766')).toBeNull();
  });

  it('não gasta chamada quando não há dígito nenhum', async () => {
    const { service, chamadas } = montarServico({ responder: baseComMascara });

    expect(await service.procurarNoIxcPorCpfCnpj('  ')).toBeNull();
    expect(chamadas).toHaveLength(0);
  });

  it('IXC fora do ar continua sendo IXC fora do ar', async () => {
    const { service } = montarServico({ recusar: () => true });

    await expect(
      service.procurarNoIxcPorCpfCnpj('11122233344'),
    ).rejects.toThrow();
  });
});

describe('garantirParaAvulso', () => {
  it('reusa o fornecedor que já existe, mesmo digitado sem máscara', async () => {
    const { service, ixc } = montarServico({ responder: baseComMascara });

    expect(await service.garantirParaAvulso('b1')).toBe(3246);
    expect(ixc.create).not.toHaveBeenCalled();
  });

  it('grava o documento com máscara ao criar, como o IXC espera', async () => {
    const { service, criados } = montarServico({ responder: () => [] });

    expect(await service.garantirParaAvulso('b1')).toBe(4100);
    expect(criados[0]).toMatchObject({ cpf_cnpj: '111.222.333-44' });
  });
});
