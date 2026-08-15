import { DespesasService } from './despesas.service';
import type { CriarDespesaDto } from './dto/despesa.dto';

/**
 * A conta lançada à mão vira dívida de verdade no IXC no instante em que se
 * clica. O que este arquivo protege:
 *
 *  - a data que a pessoa escolheu é a data que sai (nada de "hoje" por baixo);
 *  - sem data escolhida, hoje — e em UTC, que é como o resto da base grava;
 *  - a etiqueta é aplicada ao número que o IXC devolveu, não ao id local;
 *  - a etiqueta falhar não derruba o lançamento: a conta já existe lá fora, e
 *    fingir que não existe seria pior que avisar.
 */

const HOJE = new Date('2026-08-15T09:30:00-03:00');

function montarServico(
  opts: { idFnApagarIxc?: number | null; erroAoClassificar?: string } = {},
) {
  const conta = {
    id: 'conta-1',
    idFnApagarIxc:
      'idFnApagarIxc' in opts ? opts.idFnApagarIxc : 4242,
    status: 'AGUARDANDO_APROVACAO',
  };

  const contasPagar = {
    criarDespesa: jest.fn().mockResolvedValue(conta),
  };
  const categorias = {
    classificar: jest.fn(async () => {
      if (opts.erroAoClassificar) throw new Error(opts.erroAoClassificar);
    }),
  };

  const service = new DespesasService(
    contasPagar as never,
    categorias as never,
  );
  return { service, contasPagar, categorias, conta };
}

const BASE: CriarDespesaDto = {
  idFornecedorIxc: 3,
  fornecedorNome: 'Companhia Energética do Maranhão',
  valor: 123.54,
  observacao: 'Energia da fazenda 08/2026',
};

describe('DespesasService.lancar', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(HOJE);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('manda ao IXC o fornecedor, o valor e a observação da tela', async () => {
    const { service, contasPagar } = montarServico();

    await service.lancar(BASE, 'u1');

    expect(contasPagar.criarDespesa).toHaveBeenCalledWith(
      expect.objectContaining({
        idFornecedorIxc: 3,
        fornecedorNome: 'Companhia Energética do Maranhão',
        valor: 123.54,
        observacao: 'Energia da fazenda 08/2026',
      }),
      'u1',
    );
  });

  it('usa as datas escolhidas, sem escorregar de dia pelo fuso', async () => {
    const { service, contasPagar } = montarServico();

    await service.lancar({
      ...BASE,
      dataEmissao: '2026-08-01',
      dataVencimento: '2026-09-10',
    });

    const [dados] = contasPagar.criarDespesa.mock.calls[0];
    // O IXC recebe DD/MM/AAAA lido em UTC: gravar meia-noite local faria a
    // conta lançada de madrugada sair com a data do dia anterior.
    expect(dados.dataEmissao.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(dados.dataVencimento.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('sem data escolhida, emissão e vencimento são hoje', async () => {
    const { service, contasPagar } = montarServico();

    await service.lancar(BASE);

    const [dados] = contasPagar.criarDespesa.mock.calls[0];
    expect(dados.dataEmissao.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(dados.dataVencimento.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('etiqueta a conta pelo número que o IXC devolveu', async () => {
    const { service, categorias } = montarServico();

    const r = await service.lancar({ ...BASE, categoriaId: 'cat-1' }, 'u1');

    expect(categorias.classificar).toHaveBeenCalledWith(4242, 'cat-1', 'u1');
    expect(r.avisoCategoria).toBeNull();
  });

  it('sem categoria escolhida, não classifica nada', async () => {
    const { service, categorias } = montarServico();

    await service.lancar(BASE);

    expect(categorias.classificar).not.toHaveBeenCalled();
  });

  it('conta sem número do IXC: avisa em vez de etiquetar no escuro', async () => {
    const { service, categorias } = montarServico({ idFnApagarIxc: null });

    const r = await service.lancar({ ...BASE, categoriaId: 'cat-1' });

    expect(categorias.classificar).not.toHaveBeenCalled();
    expect(r.avisoCategoria).toContain('não recebeu número do IXC');
  });

  it('etiqueta que falha não derruba a conta já criada no IXC', async () => {
    const { service } = montarServico({ erroAoClassificar: 'banco fora' });

    const r = await service.lancar({ ...BASE, categoriaId: 'cat-1' });

    expect(r.conta.idFnApagarIxc).toBe(4242);
    expect(r.avisoCategoria).toContain('banco fora');
  });
});
