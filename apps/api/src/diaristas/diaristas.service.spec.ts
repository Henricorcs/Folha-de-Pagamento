import {
  FormaPagamentoDiaria,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import { DiaristasService } from './diaristas.service';

/**
 * O que importa aqui: dinheiro entregue na mão nunca se perde. Se o caixa do
 * IXC não aceitar (ou nem for encontrado), a diária tem de ficar registrada
 * com o motivo — nunca sumir porque o IXC não respondeu.
 */
const DIARISTA = {
  id: 'd1',
  nome: 'João da Silva',
  cpfCnpj: null,
  telefone: null,
  chavePix: 'joao@pix',
  tipoChavePix: null,
  valorDiaria: 120,
  formaPagamento: FormaPagamentoDiaria.IXC,
  observacoes: null,
  ativo: true,
  idFornecedorIxc: null,
  cidadeIxc: null,
};

const CFG = {
  caixaEmMaosId: 0,
  caixaEmMaosNome: 'CX - Werick',
  caixaTabelaContas: '',
  caixaTabelaMovimento: '',
};

function montarServico(
  opts: {
    /** null = o app não achou o caixa no IXC. */
    caixaId?: number | null;
    /** Erro devolvido pelo lançamento no caixa. */
    erroLancamento?: string;
    avisoLancamento?: string;
  } = {},
) {
  const diarias = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const prisma = {
    diarista: {
      findUnique: jest.fn().mockResolvedValue(DIARISTA),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(
        async ({ data }: { data: Record<string, unknown> }) => ({
          ...DIARISTA,
          ...data,
        }),
      ),
    },
    diaria: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `di${++seq}`;
        const registro = { id, ...data };
        diarias.set(id, registro);
        return registro;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const atual = { ...diarias.get(where.id), ...data };
          diarias.set(where.id, atual);
          return atual;
        },
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        diarias.get(where.id) ?? null,
      ),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn().mockResolvedValue({}),
    },
  } as any;

  const config = { obter: jest.fn().mockResolvedValue(CFG) } as any;

  const contasPagar = {
    criar: jest.fn().mockResolvedValue([{ id: 'conta-1' }]),
    remover: jest.fn().mockResolvedValue(undefined),
  } as any;

  const lancarSaida = jest.fn(async () => {
    if (opts.erroLancamento) throw new Error(opts.erroLancamento);
    return { tabela: 'fn_lancamento_caixa', id: 900, aviso: opts.avisoLancamento };
  });
  const caixa = {
    resolverCaixa: jest
      .fn()
      .mockResolvedValue(opts.caixaId === undefined ? 27 : opts.caixaId),
    lancarSaida,
  } as any;

  return {
    service: new DiaristasService(prisma, config, contasPagar, caixa),
    contasPagar,
    lancarSaida,
    prisma,
  };
}

describe('pagar pelo IXC', () => {
  it('vira conta a pagar de diária, com a observação montada', async () => {
    const { service, contasPagar } = montarServico();

    const diaria = await service.pagar(
      'd1',
      {
        quantidade: 2,
        descricao: 'Pintura do galpão',
        forma: FormaPagamentoDiaria.IXC,
      },
      'user-1',
    );

    expect(contasPagar.criar).toHaveBeenCalledWith(
      {
        itens: [
          {
            diaristaId: 'd1',
            tipo: TipoLancamento.DIARIA,
            valor: 240,
            observacao: 'Pintura do galpão (2 diárias de R$ 120,00)',
          },
        ],
      },
      'user-1',
    );
    expect(diaria).toMatchObject({ contaPagarId: 'conta-1' });
  });

  it('usa o valor da diária do cadastro quando não vem na tela', async () => {
    const { service, contasPagar } = montarServico();
    await service.pagar('d1', { descricao: 'Capina' });
    expect(contasPagar.criar.mock.calls[0][0].itens[0].valor).toBe(120);
  });

  it('valor fechado combinado na hora vence a multiplicação', async () => {
    const { service, contasPagar } = montarServico();
    await service.pagar('d1', {
      quantidade: 2.5,
      valor: 300,
      descricao: 'Mudança',
    });
    expect(contasPagar.criar.mock.calls[0][0].itens[0].valor).toBe(300);
  });

  /**
   * A chave recusada pelo IXC se acerta na hora de pagar. Como é o cadastro que
   * alimenta a conta a pagar, o acerto tem de ficar gravado — senão o próximo
   * pagamento repete o mesmo erro.
   */
  it('grava no cadastro a chave PIX corrigida na hora', async () => {
    const { service, prisma } = montarServico();

    await service.pagar('d1', {
      descricao: 'Capina',
      chavePix: '(99) 99230-0993',
      tipoChavePix: 'Celular',
    });

    expect(prisma.diarista.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { chavePix: '(99) 99230-0993', tipoChavePix: 'Celular' },
    });
  });

  it('chave igual à do cadastro não mexe no cadastro', async () => {
    const { service, prisma } = montarServico();
    await service.pagar('d1', { descricao: 'Capina', chavePix: 'joao@pix' });
    expect(prisma.diarista.update).not.toHaveBeenCalled();
  });
});

describe('pagar em mãos', () => {
  it('desconta do caixa e guarda o lançamento do IXC', async () => {
    const { service, lancarSaida } = montarServico();

    const diaria = await service.pagar('d1', {
      descricao: 'Roçada',
      forma: FormaPagamentoDiaria.EM_MAOS,
    });

    expect(lancarSaida).toHaveBeenCalledWith(
      expect.objectContaining({
        caixaId: 27,
        valor: 120,
        historico: 'Diária João da Silva — 1 diária de R$ 120,00 — Roçada',
      }),
      CFG,
    );
    expect(diaria).toMatchObject({
      caixaIxc: 27,
      idLancamentoIxc: 900,
      erroIxc: null,
    });
    expect(diaria.lancadoEm).toBeInstanceOf(Date);
  });

  it('IXC recusando o lançamento: a diária fica registrada com o motivo', async () => {
    const { service } = montarServico({
      erroLancamento: 'tabela sem lançamento modelo',
    });

    const diaria = await service.pagar('d1', {
      descricao: 'Roçada',
      forma: FormaPagamentoDiaria.EM_MAOS,
    });

    expect(diaria.id).toBeTruthy();
    expect(diaria.idLancamentoIxc).toBeUndefined();
    expect(diaria.erroIxc).toMatch(/lançamento modelo/);
  });

  it('caixa não encontrado: registra e explica, sem tentar lançar', async () => {
    const { service, lancarSaida } = montarServico({ caixaId: null });

    const diaria = await service.pagar('d1', {
      descricao: 'Roçada',
      forma: FormaPagamentoDiaria.EM_MAOS,
    });

    expect(lancarSaida).not.toHaveBeenCalled();
    expect(diaria.erroIxc).toMatch(/CX - Werick/);
  });

  it('lançou mas algo não conferiu: guarda o aviso para alguém olhar', async () => {
    const { service } = montarServico({
      avisoLancamento: 'Lançamento 900 criado, mas o valor gravado não é o do pagamento.',
    });
    const diaria = await service.pagar('d1', {
      descricao: 'Roçada',
      forma: FormaPagamentoDiaria.EM_MAOS,
    });
    expect(diaria).toMatchObject({ idLancamentoIxc: 900 });
    expect(diaria.erroIxc).toMatch(/Confira|conferiu|valor gravado/i);
  });

  it('usa a forma habitual do cadastro quando a tela não escolhe', async () => {
    const { service, contasPagar } = montarServico();
    // O cadastro do João é IXC: sem escolha na tela, vai por lá.
    await service.pagar('d1', { descricao: 'Capina' });
    expect(contasPagar.criar).toHaveBeenCalled();
  });
});

describe('tentar de novo e fechar à mão', () => {
  it('não lança duas vezes a mesma diária', async () => {
    const { service } = montarServico();
    const diaria = await service.pagar('d1', {
      descricao: 'Roçada',
      forma: FormaPagamentoDiaria.EM_MAOS,
    });
    await expect(service.lancarNoCaixa(diaria.id)).rejects.toThrow(/já saiu do caixa/i);
  });

  it('tentar de novo depois de configurar o caixa resolve a pendência', async () => {
    const { service, lancarSaida } = montarServico({
      erroLancamento: 'tabela não encontrada',
    });
    const diaria = await service.pagar('d1', {
      descricao: 'Roçada',
      forma: FormaPagamentoDiaria.EM_MAOS,
    });
    expect(diaria.erroIxc).toBeTruthy();

    // O usuário informou a tabela em Configurações: agora o IXC aceita.
    lancarSaida.mockImplementation(async () => ({
      tabela: 'fn_lancamento_caixa',
      id: 901,
      aviso: undefined,
    }));
    const resolvida = await service.lancarNoCaixa(diaria.id);
    expect(resolvida).toMatchObject({ idLancamentoIxc: 901, erroIxc: null });
  });

  it('lançado à mão no IXC fecha a pendência sem inventar id', async () => {
    const { service } = montarServico({ erroLancamento: 'sem tabela' });
    const diaria = await service.pagar('d1', {
      descricao: 'Roçada',
      forma: FormaPagamentoDiaria.EM_MAOS,
    });
    const fechada = await service.marcarLancadoManual(diaria.id);
    expect(fechada).toMatchObject({ lancadoManual: true, erroIxc: null });
    expect(fechada.idLancamentoIxc).toBeUndefined();
  });

  it('diária já lançada no caixa não é apagada daqui às escondidas', async () => {
    const { service, prisma } = montarServico();
    const diaria = await service.pagar('d1', {
      descricao: 'Roçada',
      forma: FormaPagamentoDiaria.EM_MAOS,
    });
    await expect(service.removerDiaria(diaria.id)).rejects.toThrow(
      /Apague por lá primeiro/i,
    );
    expect(prisma.diaria.delete).not.toHaveBeenCalled();
  });

  it('apagar diária do IXC apaga também a conta a pagar', async () => {
    const { service, contasPagar, prisma } = montarServico();
    const diaria = await service.pagar('d1', {
      descricao: 'Capina',
      forma: FormaPagamentoDiaria.IXC,
    });
    await service.removerDiaria(diaria.id);
    expect(contasPagar.remover).toHaveBeenCalledWith('conta-1');
    expect(prisma.diaria.delete).toHaveBeenCalled();
  });
});

/**
 * "Já pago" é o que saiu do bolso, não o que foi tentado. Conta a pagar parada
 * na auditoria — ou recusada pelo IXC — ainda não pagou ninguém, e somá-la ao
 * total faria a tela dizer que o diarista recebeu o que não recebeu.
 */
describe('resumo da listagem', () => {
  function comDiarias(diarias: Array<Record<string, unknown>>) {
    const { service, prisma } = montarServico();
    prisma.diarista.findMany.mockResolvedValue([
      { ...DIARISTA, diarias },
    ]);
    return service.listar();
  }

  const emMaos = (valor: number) => ({
    valor,
    data: new Date(Date.UTC(2026, 7, 10)),
    forma: FormaPagamentoDiaria.EM_MAOS,
    idLancamentoIxc: 900,
    lancadoManual: false,
    contaPagar: null,
  });

  const peloIxc = (valor: number, status: StatusContaPagar) => ({
    valor,
    data: new Date(Date.UTC(2026, 7, 10)),
    forma: FormaPagamentoDiaria.IXC,
    idLancamentoIxc: null,
    lancadoManual: false,
    contaPagar: { status },
  });

  it('conta a pagar recusada pelo IXC não entra no total pago', async () => {
    const [r] = await comDiarias([peloIxc(770, StatusContaPagar.ERRO)]);
    expect(r.totalPago).toBe(0);
    expect(r.quantidadePagas).toBe(0);
    expect(r.quantidadeComErro).toBe(1);
    // Mas continua no histórico: o registro existe e precisa de conserto.
    expect(r.quantidadeDiarias).toBe(1);
  });

  it('lançada no IXC e ainda a caminho aparece separada do que já saiu', async () => {
    const [r] = await comDiarias([
      peloIxc(300, StatusContaPagar.AGUARDANDO_APROVACAO),
      peloIxc(200, StatusContaPagar.AGUARDANDO_PAGAMENTO),
    ]);
    expect(r.totalPago).toBe(0);
    expect(r.totalAguardando).toBe(500);
    expect(r.quantidadeAguardando).toBe(2);
  });

  it('o banco confirmou: aí sim entra no total pago', async () => {
    const [r] = await comDiarias([
      peloIxc(140, StatusContaPagar.PAGO),
      peloIxc(770, StatusContaPagar.ERRO),
    ]);
    expect(r.totalPago).toBe(140);
    expect(r.quantidadePagas).toBe(1);
    expect(r.totalAguardando).toBe(0);
  });

  it('em mãos conta como pago na hora — o dinheiro já saiu da gaveta', async () => {
    const [r] = await comDiarias([emMaos(120), emMaos(80)]);
    expect(r.totalPago).toBe(200);
    expect(r.quantidadePagas).toBe(2);
    expect(r.quantidadeAguardando).toBe(0);
  });

  it('reprovada e cancelada não ficam eternamente "a caminho"', async () => {
    const [r] = await comDiarias([
      peloIxc(100, StatusContaPagar.REPROVADO),
      peloIxc(100, StatusContaPagar.CANCELADO),
    ]);
    expect(r.totalPago).toBe(0);
    expect(r.totalAguardando).toBe(0);
    expect(r.quantidadeAguardando).toBe(0);
  });
});
