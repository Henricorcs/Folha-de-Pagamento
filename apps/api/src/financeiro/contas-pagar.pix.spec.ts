import { StatusContaPagar, TipoLancamento } from '@prisma/client';
import { ContasPagarService } from './contas-pagar.service';

/**
 * O rádio "Tipo da chave Pix" em branco trava o pagamento no banco, e o código
 * de cada tipo muda de um IXC para outro. O app aprende olhando as contas
 * feitas na tela de lá — o que importa aqui é que ele **não esqueça**: o que
 * foi descoberto fica guardado, tipo a tipo, e só se volta ao IXC quando falta
 * justamente o código do tipo que está para ser enviado.
 */
const CFG_VAZIA = {
  tipoPagamentoPadrao: 'Pix',
  contaPagamentoId: 18,
  filialId: 1,
  pixCampoTipoChave: '',
  pixCodigosTipoChave: '',
  pixCampoTipoChaveAprendido: '',
  pixCodigosTipoChaveAprendidos: '',
};

/** Contas feitas na tela do IXC, de onde o formato é aprendido. */
const EXEMPLO_CELULAR = {
  id: '900',
  chave_pix: '+5599992300993',
  tipo_chave_pix_apagar: 'C',
};
const EXEMPLO_EMAIL = {
  id: '901',
  chave_pix: 'ana@pix.com',
  tipo_chave_pix_apagar: 'E',
};

function montarServico(
  opts: {
    cfg?: Partial<typeof CFG_VAZIA>;
    /** O que o IXC devolve como contas de referência. */
    registros?: Array<Record<string, unknown>>;
    /** Chave PIX do diarista que vai receber. */
    chavePix?: string;
    tipoChavePix?: string | null;
  } = {},
) {
  const cfg = { ...CFG_VAZIA, ...opts.cfg };

  const prisma = {
    contaPagar: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        status: StatusContaPagar.RASCUNHO,
        tipo: TipoLancamento.DIARIA,
        valor: 770,
        funcionarioId: null,
        beneficiarioAvulsoId: null,
        diaristaId: 'd1',
        contaPagamento: 18,
        contaContabil: 2420,
        tipoPagamentoIxc: null,
        filialId: 1,
        dataEmissao: new Date(Date.UTC(2026, 7, 10)),
        dataVencimento: new Date(Date.UTC(2026, 7, 10)),
        observacao: 'Fazenda (5,50 diárias de R$ 140,00)',
      }),
      // Contas criadas por este app — ficam de fora do aprendizado.
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: { data: object }) => ({
        id: 'c1',
        ...data,
      })),
    },
    diarista: {
      findUnique: jest.fn().mockResolvedValue({
        chavePix: opts.chavePix ?? '(99) 99230-0993',
        tipoChavePix: opts.tipoChavePix ?? null,
      }),
    },
  } as any;

  const ixc = {
    list: jest.fn().mockResolvedValue({
      registros: opts.registros ?? [EXEMPLO_CELULAR],
    }),
    create: jest.fn().mockResolvedValue({ id: 4242 }),
  } as any;

  const guardarAprendizadoPix = jest.fn().mockResolvedValue(cfg);
  const config = {
    obter: jest.fn().mockResolvedValue(cfg),
    guardarAprendizadoPix,
  } as any;

  const fornecedores = {
    garantirParaDiarista: jest.fn().mockResolvedValue(55),
  } as any;
  const vales = { estornarBaixa: jest.fn() } as any;

  return {
    service: new ContasPagarService(prisma, ixc, config, fornecedores, vales),
    ixc,
    guardarAprendizadoPix,
  };
}

describe('aprender e decorar o tipo da chave Pix', () => {
  it('aprende do IXC e guarda, para não reaprender depois de reiniciar', async () => {
    const { service, ixc, guardarAprendizadoPix } = montarServico();

    await service.enviarIxc('c1');

    expect(guardarAprendizadoPix).toHaveBeenCalledWith(
      'tipo_chave_pix_apagar',
      'Celular=C',
    );
    // E o pagamento sai com o rádio marcado no formato desta base.
    expect(ixc.create.mock.calls[0][1]).toMatchObject({
      tipo_chave_pix_apagar: 'C',
    });
  });

  it('com o código já decorado, não vai mais ao IXC atrás dele', async () => {
    const { service, ixc, guardarAprendizadoPix } = montarServico({
      cfg: {
        pixCampoTipoChaveAprendido: 'tipo_chave_pix_apagar',
        pixCodigosTipoChaveAprendidos: 'Celular=C',
      },
    });

    await service.enviarIxc('c1');

    expect(ixc.list).not.toHaveBeenCalled();
    expect(guardarAprendizadoPix).not.toHaveBeenCalled();
    expect(ixc.create.mock.calls[0][1]).toMatchObject({
      tipo_chave_pix_apagar: 'C',
    });
  });

  it('tipo novo (e-mail) se soma ao que já se sabia, sem perder o celular', async () => {
    const { service, guardarAprendizadoPix } = montarServico({
      cfg: {
        pixCampoTipoChaveAprendido: 'tipo_chave_pix_apagar',
        pixCodigosTipoChaveAprendidos: 'Celular=C',
      },
      registros: [EXEMPLO_EMAIL],
      chavePix: 'jose@pix.com',
    });

    await service.enviarIxc('c1');

    expect(guardarAprendizadoPix).toHaveBeenCalledWith(
      'tipo_chave_pix_apagar',
      'Celular=C,E-mail=E',
    );
  });

  it('coluna diferente recomeça o aprendizado: código de uma não vale na outra', async () => {
    const { service, guardarAprendizadoPix } = montarServico({
      cfg: {
        pixCampoTipoChaveAprendido: 'coluna_antiga',
        pixCodigosTipoChaveAprendidos: 'Celular=9',
      },
      registros: [EXEMPLO_EMAIL],
      chavePix: 'jose@pix.com',
    });

    await service.enviarIxc('c1');

    expect(guardarAprendizadoPix).toHaveBeenCalledWith(
      'tipo_chave_pix_apagar',
      'E-mail=E',
    );
  });

  it('o informado em Configurações vence o que foi aprendido', async () => {
    const { service, ixc } = montarServico({
      cfg: {
        pixCampoTipoChave: 'tipo_chave_pix_apagar',
        pixCodigosTipoChave: 'Celular=9',
        pixCampoTipoChaveAprendido: 'tipo_chave_pix_apagar',
        pixCodigosTipoChaveAprendidos: 'Celular=C',
      },
    });

    await service.enviarIxc('c1');

    expect(ixc.create.mock.calls[0][1]).toMatchObject({
      tipo_chave_pix_apagar: '9',
    });
  });

  it('sem exemplo no IXC daquele tipo, a conta ainda sai — com o rótulo', async () => {
    const { service, ixc, guardarAprendizadoPix } = montarServico({
      registros: [],
    });

    const conta = await service.enviarIxc('c1');

    expect(guardarAprendizadoPix).not.toHaveBeenCalled();
    expect(ixc.create.mock.calls[0][1]).toMatchObject({
      tipo_chave_pix: 'Celular',
    });
    expect(conta).toMatchObject({
      status: StatusContaPagar.AGUARDANDO_APROVACAO,
    });
  });

  it('pagamento que não é PIX não mexe no aprendizado', async () => {
    const { service, ixc, guardarAprendizadoPix } = montarServico({
      cfg: { tipoPagamentoPadrao: 'Dinheiro' },
    });

    await service.enviarIxc('c1');

    expect(ixc.list).not.toHaveBeenCalled();
    expect(guardarAprendizadoPix).not.toHaveBeenCalled();
  });
});
