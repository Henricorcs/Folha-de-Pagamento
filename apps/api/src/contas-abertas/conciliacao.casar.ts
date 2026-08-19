/**
 * Casar o extrato do banco com a movimentação do IXC.
 *
 * As duas listas descrevem o mesmo dinheiro por caminhos diferentes, e por isso
 * quase nunca são idênticas: o banco lança o PIX no dia em que ele saiu, o IXC
 * na data que quem baixou informou; o banco escreve "PIX ENVIADO 12345678", o
 * IXC escreve "Pag. Comercial Rofe Ltda - doc.: 36508". O que os dois têm em
 * comum, sempre, é o **valor**.
 *
 * Então o valor é a chave, e a data é o desempate. Três passadas, da certeza
 * para a dúvida — e cada linha só é usada uma vez, senão um pagamento repetido
 * de R$ 41,43 casaria as duas vezes com a mesma linha do banco e o extrato
 * fecharia com uma saída a menos.
 *
 * Nada aqui fala com o IXC: entram duas listas, sai o cruzamento. É por isso
 * que dá para testar cada caso esquisito sem tocar em dinheiro de verdade.
 */

import type { TransacaoExtrato } from './conciliacao.ofx';

/** Uma linha da movimentação financeira do IXC, do jeito que o casamento a vê. */
export interface LinhaParaCasar {
  /** `fn_movim_finan.id` */
  id: number;
  /** "AAAA-MM-DD" */
  data: string;
  /** Positivo = entrou na conta; negativo = saiu. O mesmo sinal do extrato. */
  valor: number;
  historico: string;
  /** O número do título, quando o histórico traz ("doc.: 36508"). */
  documento: string | null;
}

/** Como a linha do IXC e a do banco foram parar juntas. */
export type ComoCasou = 'documento' | 'exato' | 'proximo';

export interface Casamento {
  linha: LinhaParaCasar;
  transacao: TransacaoExtrato;
  como: ComoCasou;
  /** Dias entre a data do banco e a do IXC (0 = mesmo dia). */
  diasDeDiferenca: number;
}

export interface ResultadoDoCasamento {
  casados: Casamento[];
  /** Saiu (ou entrou) no banco e não existe no IXC. */
  soNoBanco: TransacaoExtrato[];
  /** Está lançado no IXC e não aparece no extrato. */
  soNoIxc: LinhaParaCasar[];
}

/**
 * Quantos dias de diferença ainda são a mesma transação.
 *
 * Três cobre o caso comum — pagou na sexta, lançou na segunda — sem chegar ao
 * ponto em que duas mensalidades do mesmo valor, em semanas diferentes, viram
 * candidatas uma da outra.
 */
export const TOLERANCIA_DIAS = 3;

export function casar(
  linhas: LinhaParaCasar[],
  transacoes: TransacaoExtrato[],
  opcoes: { toleranciaDias?: number } = {},
): ResultadoDoCasamento {
  const tolerancia = opcoes.toleranciaDias ?? TOLERANCIA_DIAS;

  const casados: Casamento[] = [];
  const livres = new Set(linhas.map((l) => l.id));
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const sobraram: TransacaoExtrato[] = [];

  /** Índice das linhas por valor em centavos — a chave de tudo. */
  const porValor = new Map<number, LinhaParaCasar[]>();
  for (const linha of linhas) {
    const chave = centavos(linha.valor);
    const lista = porValor.get(chave);
    if (lista) lista.push(linha);
    else porValor.set(chave, [linha]);
  }

  /**
   * A melhor linha livre para esta transação, ou null.
   *
   * A ordem das preferências é a ordem da certeza: o mesmo número de documento
   * é prova; o mesmo dia é quase; alguns dias de diferença é o que sobra. E
   * dentro de cada nível vence a data mais próxima, para que duas contas iguais
   * na mesma semana não troquem de lugar.
   */
  function melhorPara(
    transacao: TransacaoExtrato,
    maxDias: number,
    soPorDocumento: boolean,
  ): { linha: LinhaParaCasar; como: ComoCasou; dias: number } | null {
    const candidatas = (porValor.get(centavos(transacao.valor)) ?? []).filter(
      (l) => livres.has(l.id),
    );
    if (candidatas.length === 0) return null;

    let melhor: { linha: LinhaParaCasar; como: ComoCasou; dias: number } | null =
      null;

    for (const linha of candidatas) {
      const dias = Math.abs(diferencaEmDias(linha.data, transacao.data));
      if (dias > maxDias) continue;

      const porDocumento = mesmoDocumento(linha, transacao);
      if (soPorDocumento && !porDocumento) continue;

      const como: ComoCasou = porDocumento
        ? 'documento'
        : dias === 0
          ? 'exato'
          : 'proximo';

      if (!melhor || pesoDe(como, dias) < pesoDe(melhor.como, melhor.dias)) {
        melhor = { linha, como, dias };
      }
    }
    return melhor;
  }

  /*
   * Três passadas, na ordem da certeza — e não uma só, porque quem é examinado
   * primeiro leva a linha que talvez seja de outro:
   *
   * 1. **pelo documento**: o número do título é prova, e vale mesmo com a data
   *    diferente. Sem esta passada antes das outras, uma transação do dia 14
   *    casaria com a linha do dia 14 por ser o mesmo dia, deixando de lado a do
   *    dia 13 que traz o número dela escrito;
   * 2. **no mesmo dia**: o que bate em data e valor, sem dúvida nenhuma;
   * 3. **por perto**: o que precisa de folga no calendário. Numa passada única,
   *    a transação do dia 12 poderia levar a linha do dia 10 antes de a
   *    transação do dia 10 ser examinada, e sobrariam duas pontas erradas.
   */
  const rodadas: Array<{ maxDias: number; soPorDocumento: boolean }> = [
    { maxDias: tolerancia, soPorDocumento: true },
    { maxDias: 0, soPorDocumento: false },
    { maxDias: tolerancia, soPorDocumento: false },
  ];

  let pendentes = [...transacoes];
  for (const rodada of rodadas) {
    const restantes: TransacaoExtrato[] = [];
    for (const transacao of pendentes) {
      const achado = melhorPara(transacao, rodada.maxDias, rodada.soPorDocumento);
      if (achado) {
        livres.delete(achado.linha.id);
        casados.push({
          linha: achado.linha,
          transacao,
          como: achado.como,
          diasDeDiferenca: achado.dias,
        });
      } else {
        restantes.push(transacao);
      }
    }
    pendentes = restantes;
  }
  sobraram.push(...pendentes);

  return {
    casados: casados.sort((a, b) =>
      a.transacao.data.localeCompare(b.transacao.data),
    ),
    soNoBanco: sobraram,
    soNoIxc: [...livres]
      .map((id) => porId.get(id))
      .filter((l): l is LinhaParaCasar => l !== undefined)
      .sort((a, b) => a.data.localeCompare(b.data)),
  };
}

/**
 * Quanto vale um casamento — menor é melhor.
 *
 * O documento vence qualquer data, porque é o único que identifica a transação
 * em vez de descrevê-la. Depois é a distância no calendário.
 */
function pesoDe(como: ComoCasou, dias: number): number {
  return (como === 'documento' ? 0 : 100) + dias;
}

/**
 * O documento do banco aparece no histórico do IXC?
 *
 * O IXC escreve o número do título no histórico ("- doc.: 36508") e o banco
 * manda o dele em `CHECKNUM`. Quando os dois batem não há dúvida nenhuma —
 * mas o número precisa ter tamanho: um "1" no `CHECKNUM` casaria com qualquer
 * histórico que tivesse o algarismo 1 em algum lugar.
 */
function mesmoDocumento(
  linha: LinhaParaCasar,
  transacao: TransacaoExtrato,
): boolean {
  const doBanco = somenteDigitos(transacao.documento);
  if (doBanco.length < 3) return false;

  const doIxc = somenteDigitos(linha.documento);
  if (doIxc && doIxc === doBanco) return true;

  // O número também vive dentro do histórico, e é lá que ele está na maioria
  // das baixas ("Pag. Fulano - doc.: 36508").
  return new RegExp(`(^|\\D)${doBanco}(\\D|$)`).test(linha.historico ?? '');
}

function somenteDigitos(valor: string | null | undefined): string {
  return String(valor ?? '').replace(/\D/g, '');
}

/** Valor em centavos, para comparar sem o troco que o ponto flutuante inventa. */
function centavos(valor: number): number {
  return Math.round(valor * 100);
}

/** Dias entre duas datas "AAAA-MM-DD" (a - b). */
export function diferencaEmDias(a: string, b: string): number {
  const dia = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / dia);
}
