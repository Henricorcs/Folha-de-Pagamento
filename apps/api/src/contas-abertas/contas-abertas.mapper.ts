/**
 * Leitura das contas a pagar em aberto do IXC (`fn_apagar`).
 *
 * Aqui não se cria nem se altera nada: é a empresa vista de fora, do jeito que
 * o IXC a guarda. O que a folha lançou está no meio — é dinheiro que a empresa
 * deve igual ao resto —, e sai marcado para quem olha saber de onde veio.
 *
 * O nome das colunas do `fn_apagar` muda de uma versão do IXC para outra, e a
 * documentação do webservice não fecha a lista. Por isso cada campo é procurado
 * por vários nomes conhecidos em vez de um só: errar o nome de uma coluna aqui
 * significaria mostrar uma conta sem vencimento, ou pior, sem valor.
 */

import { parseIxcDate, parseIxcDecimal, parseIxcId } from '../ixc/ixc.parse';
import { lerStatusAuditoria, type StatusAuditoriaIxc } from '../ixc/ixc.financeiro';

/** Uma conta a pagar em aberto, como esta casa a lê. */
export interface ContaAberta {
  idFnApagar: number;
  /** Número do documento/nota, quando existe */
  documento: string | null;
  fornecedor: { id: number | null; nome: string };
  /** Valor do título */
  valor: number;
  /** O que falta pagar dele (pagamento parcial deixa os dois diferentes) */
  valorAberto: number;
  emissao: Date | null;
  vencimento: Date | null;
  /**
   * Dias até vencer. Negativo = venceu há tantos dias; null = a conta não tem
   * vencimento no IXC, e aí não há como dizer se está atrasada.
   */
  diasParaVencer: number | null;
  vencida: boolean;
  observacao: string | null;
  statusAuditoria: StatusAuditoriaIxc | null;
  /**
   * A conta de despesa do IXC — terreno, veículo, equipamento, energia. É o
   * que responde "com o que a empresa está devendo", e não só "para quem".
   * O nome pode vir vazio quando o registro só traz o código.
   */
  categoria: { id: number | null; nome: string | null };
  /** Preenchido depois, cruzando com o que a folha lançou */
  origem: OrigemNaFolha | null;
}

/** De onde a conta veio, quando quem a criou foi esta aplicação. */
export interface OrigemNaFolha {
  /** SALARIO, ADIANTAMENTO, BONUS, DIARIA, AVULSO… */
  tipo: string;
  /** Id da conta na tabela daqui, para poder abrir a tela dela */
  contaId: string;
  /** Nome de quem recebe, como está no cadastro daqui */
  beneficiario: string | null;
}

/** O apanhado da lista: é o que responde "quanto a empresa deve". */
export interface ResumoContasAbertas {
  quantidade: number;
  total: number;
  vencidas: FatiaDoResumo;
  venceEmSeteDias: FatiaDoResumo;
  demais: FatiaDoResumo;
  /** Contas sem data de vencimento no IXC — ficam de fora das três fatias */
  semVencimento: FatiaDoResumo;
}

export interface FatiaDoResumo {
  quantidade: number;
  total: number;
}

/**
 * O que ainda é dívida.
 *
 * `fn_apagar.status` diz A = aberto, P = pago, C = cancelado — mas ele sozinho
 * não basta, e isso custou caro: a primeira versão desta tela mostrava quatro
 * títulos de 2023 como vencidos que a própria tela do IXC não listava. Eles
 * têm `status = A` e mesmo assim não são devidos.
 *
 * Então são três perguntas, não uma:
 *
 * 1. o status diz que acabou (pago ou cancelado)?
 * 2. sobrou alguma coisa para pagar? Título baixado por inteiro está quitado,
 *    mesmo com o status parado em "A" — e a baixa pode estar em `valor_baixado`
 *    em vez de `valor_pago`, que era o único que se olhava antes;
 * 3. há marca de cancelamento no registro? O IXC guarda o cancelamento em
 *    campo próprio (é o que o botão "Estornar cancelamento" desfaz), e uma
 *    conta cancelada não é dívida ainda que continue com saldo em aberto.
 *
 * O filtro também é pedido ao IXC, mas é conferido de novo aqui: base que
 * ignore um `qtype` que não conhece devolve a tabela inteira, e uma tela de
 * contas em aberto cheia de conta paga mente sobre quanto a empresa deve.
 */
export function estaEmAberto(raw: Record<string, unknown>): boolean {
  return motivoDeNaoEstarAberto(raw) === null;
}

/** Por que um título não entra na lista — e por qual campo se soube disso. */
export interface MotivoDeExclusao {
  motivo: 'pago' | 'cancelado' | 'quitado';
  /** A coluna do IXC que decidiu. Serve para explicar a exclusão na tela. */
  campo: string;
}

/**
 * As colunas que marcam uma conta cancelada.
 *
 * A lista é fechada de propósito, e isso custou uma quebra para aprender: a
 * primeira versão aceitava **qualquer** coluna com "cancel" no nome, e o
 * `fn_apagar` tem colunas de configuração que falam de cancelamento sem
 * cancelar nada. O resultado foi a lista despencar de 532 títulos para 65 —
 * quatrocentas e tantas dívidas de verdade sumiram da tela de uma vez.
 *
 * Nome novo só entra aqui depois de alguém ver o registro cru e confirmar que
 * aquela coluna significa mesmo "esta conta foi cancelada".
 */
const CAMPOS_DE_CANCELAMENTO = [
  'data_cancelamento',
  'data_hora_cancelamento',
  'dt_cancelamento',
  'cancelado',
  'cancelada',
  'status_cancelamento',
] as const;

/**
 * A resposta detalhada do `estaEmAberto`: `null` quando a conta é devida, e o
 * motivo com o nome do campo quando não é. O campo não é curiosidade — é o que
 * deixa a tela dizer "467 títulos ficaram de fora pela coluna tal", que é como
 * um filtro errado se denuncia em vez de sumir com a dívida em silêncio.
 */
export function motivoDeNaoEstarAberto(
  raw: Record<string, unknown>,
): MotivoDeExclusao | null {
  const status = String(raw.status ?? '').trim().toUpperCase();
  if (status === 'P') return { motivo: 'pago', campo: 'status' };
  if (status === 'C') return { motivo: 'cancelado', campo: 'status' };

  const cancelamento = campoDeCancelamento(raw);
  if (cancelamento) return { motivo: 'cancelado', campo: cancelamento };

  // Nada a pagar não é dívida, seja qual for o status.
  if (valorEmAberto(raw) <= 0.001) {
    return { motivo: 'quitado', campo: 'valor_aberto' };
  }
  return null;
}

/**
 * A coluna que diz que esta conta foi cancelada, se houver.
 *
 * Coluna vazia, `N`, zero e data zerada são o estado normal de quem nunca
 * cancelou nada — só valor de verdade conta.
 */
function campoDeCancelamento(raw: Record<string, unknown>): string | null {
  for (const campo of CAMPOS_DE_CANCELAMENTO) {
    const s = String(raw[campo] ?? '').trim().toUpperCase();
    if (!s || s === 'N' || s === '0' || s === 'NULL') continue;
    if (/^0000-00-00/.test(s) || /^00\/00\/0000/.test(s)) continue;
    return campo;
  }
  return null;
}

/** Um registro cru do `fn_apagar` na forma que as telas usam. */
export function mapContaAberta(
  raw: Record<string, unknown>,
  hoje = new Date(),
): ContaAberta | null {
  const idFnApagar = parseIxcId(raw.id);
  if (idFnApagar === null) return null;

  const vencimento = primeiraData(raw, [
    'data_vencimento',
    'data_venc',
    'vencimento',
    'data_vencimento_original',
  ]);

  const dias = vencimento === null ? null : diasEntre(hoje, vencimento);

  return {
    idFnApagar,
    documento: primeiroTexto(raw, [
      'documento',
      'num_documento',
      'numero_documento',
      'nosso_numero',
    ]),
    fornecedor: {
      id: parseIxcId(raw.id_fornecedor ?? raw.fornecedor_id),
      nome:
        primeiroTexto(raw, [
          'fornecedor',
          'razao',
          'nome_fornecedor',
          'fornecedor_razao',
          'razao_social',
        ]) ?? '',
    },
    valor: parseIxcDecimal(raw.valor ?? raw.valor_documento),
    valorAberto: valorEmAberto(raw),
    emissao: primeiraData(raw, ['data_emissao', 'data', 'emissao']),
    vencimento,
    diasParaVencer: dias,
    // Vence hoje ainda não está vencida: o dia de pagar é hoje.
    vencida: dias !== null && dias < 0,
    observacao: primeiroTexto(raw, ['obs', 'observacao', 'historico']),
    statusAuditoria: lerStatusAuditoria(raw),
    categoria: {
      id: parseIxcId(raw.id_conta ?? raw.id_conta_despesa ?? raw.conta_despesa),
      nome: primeiroTexto(raw, [
        'conta_despesa_nome',
        'descricao_conta',
        'nome_conta',
        'plano_conta',
        'classificacao',
      ]),
    },
    origem: null,
  };
}

/**
 * Quanto ainda falta pagar.
 *
 * `valor_aberto` é a resposta direta onde a base a tem. Onde não tem, o que
 * falta é o título menos o que já saiu — e "o que já saiu" mora em mais de uma
 * coluna: o IXC chama de **baixa** o ato de quitar o título, e a tela dele
 * mostra "Valor baixado" ao lado de "Valor aberto". Olhar só `valor_pago`
 * fazia um título já baixado aparecer devendo o valor inteiro.
 */
function valorEmAberto(raw: Record<string, unknown>): number {
  const aberto = parseIxcDecimal(raw.valor_aberto);
  if (aberto > 0) return aberto;

  const valor = parseIxcDecimal(raw.valor ?? raw.valor_documento);
  const pago = Math.max(
    parseIxcDecimal(raw.valor_total_pago),
    parseIxcDecimal(raw.valor_pago),
    parseIxcDecimal(raw.valor_baixado),
  );
  return Math.max(0, arredondar(valor - pago));
}

/** As contas somadas por urgência — a leitura que decide o que pagar antes. */
export function resumirContasAbertas(
  contas: ContaAberta[],
): ResumoContasAbertas {
  const vazio = (): FatiaDoResumo => ({ quantidade: 0, total: 0 });
  const resumo: ResumoContasAbertas = {
    quantidade: contas.length,
    total: 0,
    vencidas: vazio(),
    venceEmSeteDias: vazio(),
    demais: vazio(),
    semVencimento: vazio(),
  };

  for (const c of contas) {
    resumo.total = arredondar(resumo.total + c.valorAberto);
    const fatia =
      c.diasParaVencer === null
        ? resumo.semVencimento
        : c.diasParaVencer < 0
          ? resumo.vencidas
          : c.diasParaVencer <= 7
            ? resumo.venceEmSeteDias
            : resumo.demais;

    fatia.quantidade += 1;
    fatia.total = arredondar(fatia.total + c.valorAberto);
  }

  return resumo;
}

/**
 * A ordem em que se paga: o que já venceu primeiro, o mais atrasado no topo.
 * Conta sem vencimento vai para o fim — ela não entra em nenhuma urgência.
 */
export function ordenarPorUrgencia(contas: ContaAberta[]): ContaAberta[] {
  return [...contas].sort((a, b) => {
    if (a.diasParaVencer === null) return b.diasParaVencer === null ? 0 : 1;
    if (b.diasParaVencer === null) return -1;
    if (a.diasParaVencer !== b.diasParaVencer) {
      return a.diasParaVencer - b.diasParaVencer;
    }
    // Empatou o dia: o valor maior aparece antes, que é o que pesa no caixa.
    return b.valorAberto - a.valorAberto;
  });
}

/**
 * Dias inteiros entre hoje e o vencimento, contados por dia civil.
 *
 * A conta é feita sobre a data zerada nos dois lados de propósito: comparando
 * o instante, uma conta que vence hoje às 00:00 apareceria como vencida desde
 * a hora do almoço.
 */
function diasEntre(hoje: Date, vencimento: Date): number {
  const a = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const b = Date.UTC(
    vencimento.getUTCFullYear(),
    vencimento.getUTCMonth(),
    vencimento.getUTCDate(),
  );
  return Math.round((b - a) / 86_400_000);
}

/** O primeiro dos nomes conhecidos que tiver texto de verdade. */
function primeiroTexto(
  raw: Record<string, unknown>,
  campos: string[],
): string | null {
  for (const campo of campos) {
    const s = String(raw[campo] ?? '').trim();
    if (s && s !== '0') return s;
  }
  return null;
}

/** O primeiro dos nomes conhecidos que tiver data válida. */
function primeiraData(
  raw: Record<string, unknown>,
  campos: string[],
): Date | null {
  for (const campo of campos) {
    const d = parseIxcDate(raw[campo]);
    if (d) return d;
  }
  return null;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
