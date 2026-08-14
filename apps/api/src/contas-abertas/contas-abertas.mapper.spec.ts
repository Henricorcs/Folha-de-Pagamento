import {
  estaEmAberto,
  mapContaAberta,
  ordenarPorUrgencia,
  resumirContasAbertas,
  type ContaAberta,
} from './contas-abertas.mapper';

/**
 * Esta tela responde "quanto a empresa deve e o que já venceu". Um erro aqui
 * não quebra nada — ele mente, que é pior. Por isso os casos cobrem os nomes
 * de coluna que mudam entre versões do IXC, o pagamento parcial e a virada do
 * dia do vencimento.
 */

const HOJE = new Date('2026-08-14T15:00:00Z');

/** Um fn_apagar cru como o IXC devolve: tudo string. */
function bruto(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '4821',
    status: 'A',
    id_fornecedor: '77',
    fornecedor: 'ENERGISA CEARA',
    valor: '1.250,00',
    data_emissao: '01/08/2026',
    data_vencimento: '20/08/2026',
    documento: 'NF 55123',
    obs: 'Energia da torre',
    ...over,
  };
}

describe('o que conta como aberto', () => {
  it('aceita a conta em aberto', () => {
    expect(estaEmAberto(bruto())).toBe(true);
  });

  it('descarta paga e cancelada mesmo se o IXC as devolver', () => {
    expect(estaEmAberto(bruto({ status: 'P' }))).toBe(false);
    expect(estaEmAberto(bruto({ status: 'C' }))).toBe(false);
  });

  /**
   * Base que ignora um `qtype` desconhecido devolve a tabela inteira. Sem
   * status para olhar, o desempate é o dinheiro: título quitado não é dívida.
   */
  it('sem coluna de status, decide pelo que falta pagar', () => {
    expect(estaEmAberto(bruto({ status: '', valor_aberto: '300,00' }))).toBe(true);
    expect(
      estaEmAberto(
        bruto({ status: '', valor: '300,00', valor_total_pago: '300,00' }),
      ),
    ).toBe(false);
  });
});

describe('ler uma conta', () => {
  it('traz valor, vencimento, documento e fornecedor', () => {
    const c = mapContaAberta(bruto(), HOJE)!;

    expect(c.idFnApagar).toBe(4821);
    expect(c.valor).toBe(1250);
    expect(c.documento).toBe('NF 55123');
    expect(c.fornecedor).toEqual({ id: 77, nome: 'ENERGISA CEARA' });
    expect(c.vencimento?.toISOString().slice(0, 10)).toBe('2026-08-20');
    expect(c.observacao).toBe('Energia da torre');
  });

  it('acha o nome do fornecedor com os outros nomes de coluna', () => {
    const c = mapContaAberta(
      bruto({ fornecedor: '', razao: 'CLARO S.A.' }),
      HOJE,
    )!;
    expect(c.fornecedor.nome).toBe('CLARO S.A.');
  });

  it('acha o vencimento com os outros nomes de coluna', () => {
    const c = mapContaAberta(
      bruto({ data_vencimento: '', vencimento: '25/08/2026' }),
      HOJE,
    )!;
    expect(c.vencimento?.toISOString().slice(0, 10)).toBe('2026-08-25');
  });

  it('ignora registro sem id — não há conta sem título', () => {
    expect(mapContaAberta(bruto({ id: '' }), HOJE)).toBeNull();
  });

  describe('quanto ainda falta pagar', () => {
    it('usa o valor em aberto quando a base o tem', () => {
      const c = mapContaAberta(
        bruto({ valor: '1.000,00', valor_aberto: '400,00' }),
        HOJE,
      )!;
      expect(c.valor).toBe(1000);
      expect(c.valorAberto).toBe(400);
    });

    /** Pagamento parcial numa base sem `valor_aberto`: o resto é conta. */
    it('desconta o que já foi pago quando não há valor em aberto', () => {
      const c = mapContaAberta(
        bruto({ valor: '1.000,00', valor_total_pago: '250,00' }),
        HOJE,
      )!;
      expect(c.valorAberto).toBe(750);
    });

    it('nunca devolve saldo negativo', () => {
      const c = mapContaAberta(
        bruto({ valor: '100,00', valor_total_pago: '150,00' }),
        HOJE,
      )!;
      expect(c.valorAberto).toBe(0);
    });
  });

  describe('vencimento', () => {
    it('conta os dias que faltam', () => {
      const c = mapContaAberta(bruto({ data_vencimento: '20/08/2026' }), HOJE)!;
      expect(c.diasParaVencer).toBe(6);
      expect(c.vencida).toBe(false);
    });

    /** Vence hoje é dia de pagar, não dia de estar atrasado. */
    it('a que vence hoje ainda não está vencida', () => {
      const c = mapContaAberta(bruto({ data_vencimento: '14/08/2026' }), HOJE)!;
      expect(c.diasParaVencer).toBe(0);
      expect(c.vencida).toBe(false);
    });

    it('conta os dias de atraso da que já venceu', () => {
      const c = mapContaAberta(bruto({ data_vencimento: '04/08/2026' }), HOJE)!;
      expect(c.diasParaVencer).toBe(-10);
      expect(c.vencida).toBe(true);
    });

    it('conta sem vencimento não é dada como vencida', () => {
      const c = mapContaAberta(bruto({ data_vencimento: '' }), HOJE)!;
      expect(c.diasParaVencer).toBeNull();
      expect(c.vencida).toBe(false);
    });
  });
});

describe('resumo', () => {
  function conta(dias: number | null, valorAberto: number): ContaAberta {
    return {
      idFnApagar: 1,
      documento: null,
      fornecedor: { id: null, nome: 'x' },
      valor: valorAberto,
      valorAberto,
      emissao: null,
      vencimento: dias === null ? null : new Date(),
      diasParaVencer: dias,
      vencida: dias !== null && dias < 0,
      observacao: null,
      statusAuditoria: null,
      categoria: { id: null, nome: null },
      origem: null,
    };
  }

  it('separa vencidas, a vencer em uma semana e o resto', () => {
    const r = resumirContasAbertas([
      conta(-3, 100),
      conta(-1, 50),
      conta(0, 200),
      conta(7, 300),
      conta(8, 400),
      conta(null, 25),
    ]);

    expect(r.quantidade).toBe(6);
    expect(r.total).toBe(1075);
    expect(r.vencidas).toEqual({ quantidade: 2, total: 150 });
    // O dia 0 e o dia 7 são as bordas: os dois entram na semana.
    expect(r.venceEmSeteDias).toEqual({ quantidade: 2, total: 500 });
    expect(r.demais).toEqual({ quantidade: 1, total: 400 });
    expect(r.semVencimento).toEqual({ quantidade: 1, total: 25 });
  });

  it('soma o que falta pagar, não o valor do título', () => {
    const parcial = { ...conta(5, 0), valor: 1000, valorAberto: 400 };
    expect(resumirContasAbertas([parcial]).total).toBe(400);
  });

  it('lista vazia não quebra', () => {
    const r = resumirContasAbertas([]);
    expect(r.quantidade).toBe(0);
    expect(r.total).toBe(0);
  });

  it('ordena da mais atrasada para a mais distante, com a sem data no fim', () => {
    const ordenada = ordenarPorUrgencia([
      conta(5, 10),
      conta(null, 10),
      conta(-8, 10),
      conta(0, 10),
    ]);
    expect(ordenada.map((c) => c.diasParaVencer)).toEqual([-8, 0, 5, null]);
  });

  it('no mesmo dia, o valor maior vem primeiro', () => {
    const ordenada = ordenarPorUrgencia([conta(3, 100), conta(3, 900)]);
    expect(ordenada.map((c) => c.valorAberto)).toEqual([900, 100]);
  });
});

/**
 * Os quatro titulos fantasma.
 *
 * A primeira versao desta tela mostrou quatro contas de 2023 como vencidas que
 * a tela do proprio IXC nao listava: 532 aqui contra 528 la. Todas com
 * `status = A`. O status sozinho nao diz se a conta ainda e devida -- e uma
 * conta que nao e devida aparecendo como vencida faz alguem correr atras de
 * uma divida que nao existe.
 */
describe('o que parece aberto mas nao e', () => {
  it('titulo baixado por inteiro nao e divida, mesmo com status A', () => {
    expect(
      estaEmAberto(
        bruto({ status: 'A', valor: '877,89', valor_baixado: '877,89' }),
      ),
    ).toBe(false);
  });

  it('baixa parcial continua sendo divida pelo que sobrou', () => {
    const raw = bruto({ status: 'A', valor: '1.000,00', valor_baixado: '400,00' });
    expect(estaEmAberto(raw)).toBe(true);
    expect(mapContaAberta(raw, HOJE)!.valorAberto).toBe(600);
  });

  it('conta cancelada sai da lista mesmo com saldo em aberto', () => {
    expect(
      estaEmAberto(bruto({ status: 'A', data_cancelamento: '10/08/2023' })),
    ).toBe(false);
    expect(estaEmAberto(bruto({ status: 'A', cancelado: 'S' }))).toBe(false);
  });

  /** Coluna de cancelamento vazia e o estado normal de quem nunca cancelou. */
  it('coluna de cancelamento em branco nao cancela nada', () => {
    expect(estaEmAberto(bruto({ motivo_cancelamento: '' }))).toBe(true);
    expect(estaEmAberto(bruto({ cancelado: 'N' }))).toBe(true);
    expect(estaEmAberto(bruto({ data_cancelamento: '0000-00-00' }))).toBe(true);
    expect(estaEmAberto(bruto({ data_cancelamento: '00/00/0000' }))).toBe(true);
  });

  /** O botao "Estornar cancelamento" desfaz -- nao e marca de cancelada. */
  it('o estorno do cancelamento nao conta como cancelamento', () => {
    expect(
      estaEmAberto(bruto({ data_estorno_cancelamento: '12/08/2023' })),
    ).toBe(true);
  });

  it('sem nada a pagar nao aparece, ainda que ninguem tenha mudado o status', () => {
    expect(
      estaEmAberto(bruto({ status: 'A', valor: '100,00', valor_aberto: '0,00', valor_total_pago: '100,00' })),
    ).toBe(false);
  });
});

describe('categoria da despesa', () => {
  it('le o codigo da conta de despesa', () => {
    const c = mapContaAberta(bruto({ id_conta: '2420' }), HOJE)!;
    expect(c.categoria.id).toBe(2420);
  });

  it('usa o nome quando o proprio registro o traz', () => {
    const c = mapContaAberta(
      bruto({ id_conta: '318', descricao_conta: 'VEICULOS' }),
      HOJE,
    )!;
    expect(c.categoria).toEqual({ id: 318, nome: 'VEICULOS' });
  });

  it('sem conta nenhuma, fica vazia em vez de inventar', () => {
    const c = mapContaAberta(bruto(), HOJE)!;
    expect(c.categoria).toEqual({ id: null, nome: null });
  });
});
