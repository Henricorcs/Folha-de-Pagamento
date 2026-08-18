import {
  acharCaixaPorNome,
  buildLancamentoSaida,
  conferirLancamento,
  detectarCamposMovimento,
  mapCaixa,
  type CamposMovimento,
} from './ixc.caixa';

describe('mapCaixa / acharCaixaPorNome', () => {
  const CAIXAS = [
    mapCaixa({ id: '18', descricao: 'Banco Inter', tipo: 'Banco' })!,
    mapCaixa({ id: '27', descricao: 'CX - Werick', tipo: 'Caixa' })!,
    mapCaixa({ id: '31', nome: 'CX - Loja Centro' })!,
  ];

  it('lê id, nome e tipo em qualquer das colunas conhecidas', () => {
    expect(CAIXAS[0]).toEqual({
      id: 18,
      nome: 'Banco Inter',
      tipo: 'Banco',
      razaoId: null,
    });
    expect(CAIXAS[2]).toEqual({
      id: 31,
      nome: 'CX - Loja Centro',
      tipo: null,
      razaoId: null,
    });
  });

  /*
   * O razão é o que liga o caixa à movimentação financeira: a linha do
   * dinheiro em `fn_movim_finan` traz `id_conta` com o planejamento da conta,
   * e não com o id dela. Sem este campo a leitura do caixa procuraria pelo
   * número errado e voltaria vazia, sem erro nenhum.
   */
  it('lê a conta do razão, quando o cadastro a traz', () => {
    const comRazao = mapCaixa({
      id: '18',
      descricao: 'Conta ModoBank PIX',
      id_planejamento: '12833',
    })!;
    expect(comRazao.razaoId).toBe(12833);
  });

  it('ignora registro sem id', () => {
    expect(mapCaixa({ id: '0', descricao: 'X' })).toBeNull();
  });

  it('acha o caixa pelo nome, sem ligar para caso nem acento', () => {
    expect(acharCaixaPorNome(CAIXAS, 'CX - Werick')?.id).toBe(27);
    expect(acharCaixaPorNome(CAIXAS, 'cx - werick')?.id).toBe(27);
    expect(acharCaixaPorNome(CAIXAS, 'werick')?.id).toBe(27);
  });

  it('nome que não existe não vira caixa nenhum', () => {
    expect(acharCaixaPorNome(CAIXAS, 'CX - Fulano')).toBeNull();
    expect(acharCaixaPorNome(CAIXAS, '')).toBeNull();
  });

  it('exato vence o parcial: "CX - Loja" não rouba a vaga', () => {
    const caixas = [
      mapCaixa({ id: '5', descricao: 'CX - Werick antigo' })!,
      mapCaixa({ id: '27', descricao: 'CX - Werick' })!,
    ];
    expect(acharCaixaPorNome(caixas, 'CX - Werick')?.id).toBe(27);
  });
});

describe('detectarCamposMovimento', () => {
  it('descobre as colunas copiando um lançamento existente', () => {
    const campos = detectarCamposMovimento({
      id: '900',
      id_caixa: '27',
      data: '01/08/2026',
      valor: '150.00',
      historico: 'Suprimento de caixa',
      tipo: 'E',
    });
    expect(campos).toEqual({
      caixa: 'id_caixa',
      valor: 'valor',
      data: 'data',
      historico: 'historico',
      tipo: 'tipo',
      // O modelo era de entrada; o que se copia é o formato do código.
      tipoSaida: 'S',
    });
  });

  it('aceita nomes diferentes e rótulo por extenso no tipo', () => {
    const campos = detectarCamposMovimento({
      id: '1',
      id_contas: '27',
      data_lancamento: '01/08/2026',
      valor_lancamento: '10.00',
      descricao: 'Compra',
      operacao: 'Entrada',
    })!;
    expect(campos.caixa).toBe('id_contas');
    expect(campos.data).toBe('data_lancamento');
    expect(campos.historico).toBe('descricao');
    expect(campos.tipoSaida).toBe('Saída');
  });

  it('sem coluna de caixa, valor, data ou histórico não escreve nada', () => {
    // É o sinal de que a tabela descoberta não é a da movimentação.
    expect(detectarCamposMovimento({ id: '1', valor: '10' })).toBeNull();
    expect(
      detectarCamposMovimento({ id: '1', id_caixa: '2', valor: '10', data: 'x' }),
    ).toBeNull();
  });
});

describe('buildLancamentoSaida / conferirLancamento', () => {
  const CAMPOS: CamposMovimento = {
    caixa: 'id_caixa',
    valor: 'valor',
    data: 'data',
    historico: 'historico',
    tipo: 'tipo',
    tipoSaida: 'S',
  };
  const INPUT = {
    caixaId: 27,
    valor: 150,
    data: new Date(Date.UTC(2026, 7, 8)),
    historico: 'Diária João — 1 diária de R$ 150,00',
  };

  it('monta a saída nas colunas descobertas, no formato do IXC', () => {
    expect(buildLancamentoSaida(CAMPOS, INPUT)).toEqual({
      id_caixa: '27',
      valor: '150.00',
      data: '08/08/2026',
      historico: 'Diária João — 1 diária de R$ 150,00',
      tipo: 'S',
    });
  });

  it('base sem coluna de tipo simplesmente não manda o campo', () => {
    const body = buildLancamentoSaida({ ...CAMPOS, tipo: null }, INPUT);
    expect('tipo' in body).toBe(false);
  });

  it('confere o que o IXC gravou', () => {
    expect(
      conferirLancamento(
        { id: '900', id_caixa: '27', valor: '150,00' },
        CAMPOS,
        INPUT,
      ),
    ).toEqual({ ok: true });
  });

  it('valor ou caixa diferente vira aviso, não silêncio', () => {
    const outroValor = conferirLancamento(
      { id: '900', id_caixa: '27', valor: '15.00' },
      CAMPOS,
      INPUT,
    );
    expect(outroValor.ok).toBe(false);
    expect(outroValor.motivo).toMatch(/valor gravado/);

    const outroCaixa = conferirLancamento(
      { id: '900', id_caixa: '31', valor: '150.00' },
      CAMPOS,
      INPUT,
    );
    expect(outroCaixa.ok).toBe(false);
    expect(outroCaixa.motivo).toMatch(/caixa 31/);

    expect(conferirLancamento(null, CAMPOS, INPUT).ok).toBe(false);
  });
});
