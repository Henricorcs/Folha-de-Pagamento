import { competenciaSeguinte } from '../financeiro/folha.calc';

export interface ParcelaCalculada {
  numero: number;
  competencia: string;
  valor: number;
}

export interface EntradaVale {
  /** Total do vale; sozinho, é dividido entre as parcelas. */
  valorTotal?: number | null;
  /** Valor de cada parcela; quando vem, é ele que manda. */
  valorParcela?: number | null;
  quantidadeParcelas: number;
  /** "AAAA-MM" da folha em que a primeira parcela é descontada */
  competenciaInicio: string;
}

export interface ValeCalculado {
  valorTotal: number;
  valorParcela: number;
  parcelas: ParcelaCalculada[];
}

/**
 * Monta o carnê do vale: uma parcela por competência, a partir do mês
 * escolhido. Se o usuário informou o valor da parcela, ele vale para todas e o
 * total é o produto. Se informou só o total, a divisão fica em centavos
 * redondos e a última parcela absorve a sobra.
 */
export function montarParcelas(entrada: EntradaVale): ValeCalculado {
  const qtd = Math.max(1, Math.trunc(entrada.quantidadeParcelas));
  const informadoParcela = arredondar(entrada.valorParcela ?? 0);
  const informadoTotal = arredondar(entrada.valorTotal ?? 0);

  const valorParcela =
    informadoParcela > 0
      ? informadoParcela
      : truncarCentavos(informadoTotal / qtd);
  const valorTotal =
    informadoParcela > 0 ? arredondar(valorParcela * qtd) : informadoTotal;

  const parcelas: ParcelaCalculada[] = [];
  let competencia = entrada.competenciaInicio;
  let acumulado = 0;
  for (let numero = 1; numero <= qtd; numero++) {
    // A última fecha a conta exatamente no total (evita sobra de centavos).
    const valor =
      numero === qtd ? arredondar(valorTotal - acumulado) : valorParcela;
    acumulado = arredondar(acumulado + valor);
    parcelas.push({ numero, competencia, valor });
    competencia = competenciaSeguinte(competencia);
  }

  return { valorTotal, valorParcela, parcelas };
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncarCentavos(n: number): number {
  return Math.floor(n * 100) / 100;
}
