/**
 * Movimentação financeira do IXC (Financeiro > Movimentação > Financeira):
 * o caixa de onde sai o dinheiro pago em mãos.
 *
 * Nem a tabela de contas/caixas nem a de lançamentos estão na documentação
 * pública do webservice, e o nome muda entre versões. Então aqui nada é
 * chutado às cegas: os nomes são descobertos testando candidatos (consulta,
 * que não altera nada) e o corpo do lançamento é montado **espelhando os
 * campos de um registro que já existe** naquela tabela. Sem um modelo real
 * para copiar, o app não escreve nada — prefere avisar que o lançamento tem
 * de ser feito na mão. Mesmo caminho já usado para a aba de dados bancários
 * do fornecedor.
 */
import { formatDataIxc, formatValorIxc } from './ixc.financeiro';
import { parseIxcDecimal, parseIxcId } from './ixc.parse';

/**
 * Nomes prováveis da tabela de contas/caixas, na ordem de tentativa.
 *
 * `contas` vem primeiro porque é o nome certo: está na documentação (Cadastros
 * > Financeiro > Contas) e responde no IXC desta casa. Ele era o segundo, atrás
 * de um `fn_contas` que não existe — uma chamada recusada em toda leitura de
 * caixa, à toa.
 */
export const TABELAS_CONTAS_CAIXA = [
  'contas',
  'fn_contas',
  'fn_caixa',
  'caixa',
  'financeiro_contas',
];

/**
 * Nomes prováveis da tabela de lançamentos da movimentação financeira.
 *
 * **Nenhum destes existe no webservice.** Foram testados um a um contra o IXC:
 * todos respondem "Recurso X não está disponível", e a documentação também não
 * traz nenhum equivalente — o que ela tem de "caixa" é caixa de fibra, do mapa
 * da rede.
 *
 * A consequência está no comportamento e é intencional: sem tabela, o
 * `CaixaService` não escreve nada e o pagamento em mãos é marcado como
 * "lançar no IXC à mão". A lista fica porque o nome pode aparecer noutra versão
 * — mas quem for procurar por que a saída do caixa nunca é lançada sozinha,
 * a resposta é esta.
 */
export const TABELAS_MOVIMENTO_CAIXA = [
  'fn_lancamento_caixa',
  'fn_lanc_caixa',
  'fn_caixa_lancamento',
  'fn_movimento_caixa',
  'fn_mov_caixa',
  'fn_lancamentos',
  'fn_lancamento',
  'movimentacao_financeira',
];

/**
 * De onde se **leem** os lançamentos de um caixa.
 *
 * Lista à parte da de cima, e não um item acrescentado nela, por um motivo de
 * segurança: aquela é a que o `lancarSaida` usa para **escrever**. Hoje ela não
 * acha nada e a escrita fica desligada de propósito — o pagamento em mãos é
 * marcado como "lançar no IXC à mão". Juntar as duas ligaria a escrita
 * automática sem ninguém ter pedido, e logo numa tabela em que a baixa é um
 * **par** de linhas (`M`, o dinheiro saindo, e `P`, a despesa): escrever meio
 * par ali é o defeito que já custou três títulos tortos nesta base.
 *
 * `fn_movim_finan` é a que existe: é dela que a conciliação lê as pernas do
 * pagamento, e é onde o IXC guarda a movimentação financeira desta instalação.
 */
export const TABELAS_MOVIMENTO_LEITURA = [
  'fn_movim_finan',
  ...TABELAS_MOVIMENTO_CAIXA,
];

/** Um caixa/conta do IXC, do jeito que a tela de configuração mostra. */
export interface CaixaIxc {
  id: number;
  nome: string;
  /** Texto cru do tipo (Caixa, Banco…), quando a base informa. */
  tipo: string | null;
  /**
   * `contas.id_planejamento`: a conta do razão deste caixa.
   *
   * É por ela que a movimentação financeira se liga ao caixa — a linha do
   * dinheiro em `fn_movim_finan` traz o razão em `id_conta`, e não o id do
   * caixa. Obrigatório no cadastro do IXC, então na prática sempre vem.
   */
  razaoId: number | null;
}

/** Converte um registro cru da tabela de contas em caixa (null se sem id). */
export function mapCaixa(raw: Record<string, unknown>): CaixaIxc | null {
  const id = parseIxcId(raw.id);
  if (id === null) return null;
  return {
    id,
    nome: primeiroTexto(raw, ['descricao', 'nome', 'conta', 'apelido', 'titulo']) ?? `Conta ${id}`,
    tipo: primeiroTexto(raw, ['tipo', 'tipo_conta', 'especie']),
    razaoId: parseIxcId(raw.id_planejamento),
  };
}

/**
 * Acha o caixa pelo nome escrito na configuração ("CX - Werick"). Compara sem
 * caso e sem acento, primeiro exato e depois por conteúdo — o nome digitado
 * raramente bate letra por letra com o cadastro.
 */
export function acharCaixaPorNome(
  caixas: CaixaIxc[],
  nome: string,
): CaixaIxc | null {
  const alvo = normalizar(nome);
  if (!alvo) return null;
  return (
    caixas.find((c) => normalizar(c.nome) === alvo) ??
    caixas.find((c) => normalizar(c.nome).includes(alvo)) ??
    null
  );
}

/**
 * O `fn_movim_finan`, que a documentação do IXC chama de "Contabilidade".
 *
 * Não é uma tabela de caixa com uma coluna de valor: é contabilidade de
 * partida dobrada. O dinheiro mora em `debito` e `credito`, e a conta é o
 * razão (`id_conta`), não o caixa. Por isso ela não passa pela detecção
 * genérica de colunas — aquela procura um `valor` que aqui não existe, desiste,
 * e a tela recebia "não achei o formato".
 *
 * Campos, da coleção do Postman (`Contabilidade (inserir)`):
 *
 *     id_conta*, data*, data2, documento, debito, credito,
 *     historico*, historico2, tipo_lanc, id_movim_finan,
 *     id_entrada, id_saida, ultima_atualizacao
 *
 * Débito e crédito, num caixa, são entrada e saída nesta ordem: caixa é conta
 * de ativo, e ativo que diminui é crédito. Bate com o que esta base já mostrou
 * — pagar um título pelo ModoBank escreve a perna `M` no razão daquela conta,
 * que é o dinheiro saindo dela, e a `P` na despesa.
 */
export const CAMPOS_MOVIM_FINAN: CamposMovimento = {
  caixa: 'id_conta',
  /** Não há coluna única de valor: quem manda são `debito` e `credito`. */
  valor: '',
  data: 'data',
  historico: 'historico',
  tipo: null,
  tipoSaida: '',
};

export const TABELA_MOVIM_FINAN = 'fn_movim_finan';

/** Onde cada informação do lançamento mora, nesta base do IXC. */
export interface CamposMovimento {
  /** Coluna que liga o lançamento ao caixa. */
  caixa: string;
  valor: string;
  data: string;
  /** Histórico/descrição do lançamento. */
  historico: string;
  /** Coluna de entrada/saída, quando existe. */
  tipo: string | null;
  /** Valor que significa "saída" nessa coluna. */
  tipoSaida: string;
}

/**
 * Descobre, a partir de um lançamento que já existe, em quais colunas escrever.
 * Retorna null quando falta o essencial (caixa, valor ou data) — é o sinal de
 * que não dá para escrever nessa tabela com segurança.
 */
export function detectarCamposMovimento(
  modelo: Record<string, unknown>,
): CamposMovimento | null {
  const chaves = Object.keys(modelo);
  const achar = (...testes: RegExp[]): string | null => {
    for (const teste of testes) {
      const achado = chaves.find((k) => teste.test(k));
      if (achado) return achado;
    }
    return null;
  };

  const caixa = achar(/^id_caixa$/i, /^id_contas?$/i, /caixa/i, /contas?$/i);
  const valor = achar(/^valor$/i, /valor/i);
  const data = achar(/^data$/i, /^data_lancamento$/i, /data/i);
  const historico =
    achar(/hist/i, /descri/i, /^obs$/i, /obs/i, /complemento/i) ?? null;
  if (!caixa || !valor || !data || !historico) return null;

  const tipo = achar(/^tipo$/i, /^operacao$/i, /^e_s$/i, /tipo/i);
  return {
    caixa,
    valor,
    data,
    historico,
    tipo,
    tipoSaida: tipo ? valorDeSaida(modelo[tipo]) : 'S',
  };
}

/**
 * Como esta base escreve "saída" na coluna de tipo. O registro modelo pode ser
 * de entrada ou de saída, então o que se aproveita dele é o **formato**: código
 * de uma letra vira "S", rótulo por extenso vira "Saída".
 */
function valorDeSaida(exemplo: unknown): string {
  const s = String(exemplo ?? '').trim();
  if (s.length === 1) return 'S';
  if (/^(entrada|saida|saída)$/i.test(s)) return 'Saída';
  return 'S';
}

export interface LancamentoCaixaInput {
  caixaId: number;
  valor: number;
  data: Date;
  historico: string;
}

/** Monta o corpo do lançamento de saída usando as colunas descobertas. */
export function buildLancamentoSaida(
  campos: CamposMovimento,
  input: LancamentoCaixaInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    [campos.caixa]: String(input.caixaId),
    [campos.valor]: formatValorIxc(input.valor),
    [campos.data]: formatDataIxc(input.data),
    [campos.historico]: input.historico,
  };
  if (campos.tipo) body[campos.tipo] = campos.tipoSaida;
  return body;
}

/**
 * Confere se o lançamento gravado no IXC é mesmo o que se pediu: caixa certo e
 * valor certo. Escrever numa tabela descoberta por tentativa exige olhar o
 * resultado — melhor avisar "confira no IXC" do que dar por feito.
 */
export function conferirLancamento(
  raw: Record<string, unknown> | null,
  campos: CamposMovimento,
  input: LancamentoCaixaInput,
): { ok: boolean; motivo?: string } {
  if (!raw) return { ok: false, motivo: 'o lançamento não foi encontrado depois de criado' };

  const valor = parseIxcDecimal(raw[campos.valor]);
  if (Math.abs(valor - input.valor) > 0.005) {
    return {
      ok: false,
      motivo: `o valor gravado (${formatValorIxc(valor)}) não é o do pagamento`,
    };
  }
  const caixa = parseIxcId(raw[campos.caixa]);
  if (caixa !== input.caixaId) {
    return { ok: false, motivo: `foi lançado no caixa ${caixa ?? '?'}` };
  }
  return { ok: true };
}

function primeiroTexto(
  raw: Record<string, unknown>,
  candidatos: string[],
): string | null {
  const porNome = new Map(
    Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v] as const),
  );
  for (const nome of candidatos) {
    const s = String(porNome.get(nome) ?? '').trim();
    if (s) return s;
  }
  return null;
}

/** Minúsculas, sem acento e sem espaço sobrando. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
