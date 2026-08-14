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
