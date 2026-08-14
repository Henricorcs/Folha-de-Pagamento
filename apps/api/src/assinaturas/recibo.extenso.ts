/**
 * O valor escrito por extenso, como todo recibo traz.
 *
 * Não é enfeite: o número em algarismos é a parte fácil de adulterar depois de
 * assinado — um "1" vira "4" com uma canetada. O extenso é o que trava o valor
 * no papel, e é por isso que a praxe é escrever os dois.
 */

const UNIDADES = [
  '',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];

const DEZENAS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];

const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

/** De 1 a 999. "Cem" só existe redondo: 101 já é "cento e um". */
function ate999(n: number): string {
  if (n === 100) return 'cem';

  const centena = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];

  if (centena > 0) partes.push(CENTENAS[centena]);
  if (resto > 0) {
    if (resto < 20) {
      partes.push(UNIDADES[resto]);
    } else {
      const dezena = Math.floor(resto / 10);
      const unidade = resto % 10;
      partes.push(
        unidade > 0
          ? `${DEZENAS[dezena]} e ${UNIDADES[unidade]}`
          : DEZENAS[dezena],
      );
    }
  }
  return partes.join(' e ');
}

/** A parte inteira, até os milhões — nenhuma diária passa disso. */
function extensoInteiro(n: number): string {
  if (n === 0) return 'zero';

  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor(n / 1000) % 1000;
  const unidades = n % 1000;
  const partes: string[] = [];

  if (milhoes > 0) {
    partes.push(`${ate999(milhoes)} ${milhoes === 1 ? 'milhão' : 'milhões'}`);
  }
  // "mil", nunca "um mil".
  if (milhares > 0) {
    partes.push(milhares === 1 ? 'mil' : `${ate999(milhares)} mil`);
  }
  if (unidades > 0) partes.push(ate999(unidades));

  return juntar(partes, unidades);
}

/**
 * "cento e vinte reais e cinquenta centavos".
 *
 * Os centavos entram a partir do valor em centavos, não de uma multiplicação:
 * `0.29 * 100` dá 28,999… em ponto flutuante, e o recibo sairia com um centavo
 * a menos que o pagamento.
 */
export function valorPorExtenso(valor: number): string {
  const centavosTotais = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;

  const partes: string[] = [];
  if (reais > 0) {
    partes.push(`${extensoInteiro(reais)} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (centavos > 0) {
    partes.push(
      `${extensoInteiro(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`,
    );
  }
  if (partes.length === 0) return 'zero reais';

  return partes.join(' e ');
}

/**
 * Junta os grupos do jeito que se lê em voz alta. O "e" antes do último grupo
 * só entra quando ele é pequeno ou redondo — "mil e duzentos", mas "mil,
 * duzentos e trinta e quatro", que já tem o seu próprio "e" dentro.
 */
function juntar(partes: string[], ultimoValor: number): string {
  if (partes.length <= 1) return partes.join('');

  const ligacao = ultimoValor < 100 || ultimoValor % 100 === 0 ? ' e ' : ', ';
  return partes.slice(0, -1).join(', ') + ligacao + partes[partes.length - 1];
}
