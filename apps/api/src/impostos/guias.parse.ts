/**
 * Leitura das guias que a contabilidade manda todo mês.
 *
 * São três documentos de origens diferentes — DARF previdenciário e DAS do
 * Simples (ambos do SENDA, da Receita) e a guia do FGTS Digital (da Caixa). O
 * texto extraído do PDF vem com as colunas fora de ordem, então nada aqui
 * depende de posição: tudo é ancorado no rótulo impresso ("Total da Guia:",
 * "Pagar até:"), que é o que não muda entre uma competência e outra.
 *
 * O que sai daqui é uma **leitura**, não um lançamento: quem confere é a
 * pessoa na tela, antes de gravar.
 */

/** Documento reconhecido pelo leitor. */
export type TipoGuia = 'DARF_INSS' | 'FGTS' | 'DAS_SIMPLES';

/**
 * O que aquele item representa no bolso da empresa.
 *
 * A separação existe porque somar tudo mente: o INSS descontado do trabalhador
 * passa pela conta da empresa mas é dinheiro dele, e IRPJ/COFINS/ICMS são
 * imposto sobre faturamento, não sobre gente.
 */
export type ClasseTributo =
  /** Custo da empresa com pessoal: FGTS e a parte patronal do INSS. */
  | 'FOLHA_PATRONAL'
  /** Retido de quem trabalha e apenas repassado: INSS do segurado, consignado. */
  | 'FOLHA_RETIDO'
  /** Tributo sobre faturamento: IRPJ, CSLL, COFINS, PIS, ICMS. */
  | 'FATURAMENTO';

export interface ItemGuiaLido {
  /** Código de receita, quando o documento traz (o FGTS não traz). */
  codigo: string | null;
  denominacao: string;
  valor: number;
  classe: ClasseTributo;
  /**
   * O leitor não conhecia este código e chutou pela denominação. A tela
   * destaca para a pessoa conferir antes de gravar.
   */
  classeIncerta: boolean;
}

export interface GuiaLida {
  tipo: TipoGuia;
  /** Período de apuração, "AAAA-MM" — o mês a que o imposto se refere. */
  competencia: string;
  /** Vencimento, "AAAA-MM-DD". */
  vencimento: string;
  valorTotal: number;
  numeroDocumento: string | null;
  cnpj: string | null;
  razaoSocial: string | null;
  /** Quantos trabalhadores a guia do FGTS declarou; null nas demais. */
  trabalhadores: number | null;
  itens: ItemGuiaLido[];
}

/** Erro de leitura com texto que serve para mostrar na tela. */
export class GuiaIlegivelError extends Error {}

/**
 * Códigos de receita conhecidos. Vale mais que a denominação porque o texto
 * do rótulo muda de um ano para o outro; o código, não.
 */
const CLASSE_POR_CODIGO: Record<string, ClasseTributo> = {
  1001: 'FATURAMENTO', // IRPJ
  1002: 'FATURAMENTO', // CSLL
  1004: 'FATURAMENTO', // COFINS
  1005: 'FATURAMENTO', // PIS
  1006: 'FOLHA_PATRONAL', // CPP — a parte patronal do INSS dentro do Simples
  1007: 'FATURAMENTO', // ICMS
  1082: 'FOLHA_RETIDO', // CP descontada do empregado
  1099: 'FOLHA_RETIDO', // CP descontada do contribuinte individual
};

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * Lê o texto de um PDF de guia. Descobre sozinho de qual documento se trata —
 * a pessoa joga o arquivo sem ter de dizer o que é.
 */
export function lerGuia(texto: string): GuiaLida {
  if (/GFD\s*-\s*Guia do FGTS Digital/i.test(texto)) return lerFgts(texto);
  if (/Composição do Documento de Arrecadação/i.test(texto)) return lerSenda(texto);
  throw new GuiaIlegivelError(
    'Não reconheci este PDF. O leitor entende DARF, DAS do Simples Nacional e guia do FGTS Digital.',
  );
}

/**
 * DARF e DAS: mesma diagramação do SENDA, muda só o título e os códigos. A
 * composição vem em linhas "código denominação valor valor", onde o último
 * número é o total do item (principal + multa + juros).
 */
function lerSenda(texto: string): GuiaLida {
  const linhas = texto.split('\n').map((l) => l.trim());
  const ehSimples = /do Simples Nacional/i.test(texto);

  const itens: ItemGuiaLido[] = [];
  for (const linha of linhas) {
    const m = /^(\d{4})\s+(.*?)((?:\s+[\d.]+,\d{2})+)$/.exec(linha);
    if (!m) continue;
    const valores = m[3].trim().split(/\s+/);
    const denominacao = m[2].trim();
    if (!denominacao) continue;
    itens.push({
      codigo: m[1],
      denominacao,
      // O último número da linha é o total do item; os anteriores são o
      // principal e, quando há, multa e juros.
      valor: parseValor(valores[valores.length - 1]),
      ...classificar(m[1], denominacao),
    });
  }

  const valorTotal =
    valorDepoisDe(texto, /Valor:\s*/) ??
    valorDepoisDe(texto, /Totais\s+/) ??
    somaDosItens(itens);

  return {
    tipo: ehSimples ? 'DAS_SIMPLES' : 'DARF_INSS',
    competencia: competenciaPorExtenso(texto),
    vencimento: vencimento(texto),
    valorTotal,
    numeroDocumento: /Número:\s*([\d.\-]+)/.exec(texto)?.[1] ?? null,
    cnpj: /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/.exec(texto)?.[1] ?? null,
    razaoSocial: razaoSocialSenda(texto),
    trabalhadores: null,
    itens,
  };
}

/**
 * FGTS Digital. Não tem código de receita e as colunas saem embaralhadas, então
 * os dois valores que interessam vêm dos totais rotulados: o FGTS do mês (custo
 * da empresa) e o consignado, que é desconto do trabalhador sendo repassado.
 */
function lerFgts(texto: string): GuiaLida {
  const fgts = valorDepoisDe(texto, /Total FGTS:\s*/);
  const consignado = valorDepoisDe(texto, /Total Consignado:\s*/);

  const itens: ItemGuiaLido[] = [];
  if (fgts !== null && fgts > 0) {
    itens.push({
      codigo: null,
      denominacao: 'FGTS mensal',
      valor: fgts,
      classe: 'FOLHA_PATRONAL',
      classeIncerta: false,
    });
  }
  if (consignado !== null && consignado > 0) {
    itens.push({
      codigo: null,
      denominacao: 'Consignado retido do trabalhador',
      valor: consignado,
      classe: 'FOLHA_RETIDO',
      classeIncerta: false,
    });
  }

  const valorTotal =
    valorDepoisDe(texto, /Total da Guia:\s*/) ??
    valorDepoisDe(texto, /Valor a recolher\s*/) ??
    somaDosItens(itens);

  // A linha "Tag" resume a guia: CNPJ base, competência e modalidade.
  const tag = /^\s*(\d{8})\s+(\d{2})\/(\d{4})\s+\w+/m.exec(texto);
  if (!tag) {
    throw new GuiaIlegivelError(
      'Guia do FGTS sem a linha de competência — o arquivo pode estar incompleto.',
    );
  }

  return {
    tipo: 'FGTS',
    competencia: `${tag[3]}-${tag[2]}`,
    vencimento: vencimento(texto),
    valorTotal,
    numeroDocumento: depoisDoRotulo(texto, 'Identificador'),
    cnpj: /(\d{2}\.\d{3}\.\d{3})/.exec(texto)?.[1] ?? null,
    razaoSocial: depoisDoRotulo(texto, 'Nome/Razão Social do Empregador'),
    // Na linha da composição, a quantidade vem logo depois da competência.
    trabalhadores: numeroDepoisDe(texto, /\d{2}\/\d{4}\s+(\d+)\s*$/m),
    itens,
  };
}

/** Classe do item: pelo código quando conhecido, pela denominação quando não. */
function classificar(
  codigo: string | null,
  denominacao: string,
): { classe: ClasseTributo; classeIncerta: boolean } {
  const conhecido = codigo ? CLASSE_POR_CODIGO[codigo] : undefined;
  if (conhecido) return { classe: conhecido, classeIncerta: false };

  // Código novo: o palpite vale para não travar o lançamento, mas a tela
  // avisa. Errar aqui é somar imposto de faturamento no custo de pessoal.
  if (/descontad|segurado|retid|consignad/i.test(denominacao)) {
    return { classe: 'FOLHA_RETIDO', classeIncerta: true };
  }
  if (/fgts|patronal|previdenciári|cpp/i.test(denominacao)) {
    return { classe: 'FOLHA_PATRONAL', classeIncerta: true };
  }
  return { classe: 'FATURAMENTO', classeIncerta: true };
}

/** "Julho/2026" → "2026-07". */
function competenciaPorExtenso(texto: string): string {
  const m = new RegExp(`(${MESES.join('|')})\\s*/\\s*(\\d{4})`, 'i').exec(texto);
  if (m) {
    const mes = MESES.indexOf(m[1].toLowerCase()) + 1;
    return `${m[2]}-${String(mes).padStart(2, '0')}`;
  }
  // Alguns documentos só trazem "PA:07/2026" na composição.
  const pa = /PA:\s*(\d{2})\/(\d{4})/.exec(texto);
  if (pa) return `${pa[2]}-${pa[1]}`;
  throw new GuiaIlegivelError(
    'Não achei o período de apuração no documento.',
  );
}

function vencimento(texto: string): string {
  const m =
    /Pagar até:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(texto) ??
    /Pagar este documento até\s*\n?\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(texto);
  if (!m) {
    throw new GuiaIlegivelError('Não achei a data de vencimento no documento.');
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Razão social: vem na mesma linha do CNPJ, logo depois dele. */
function razaoSocialSenda(texto: string): string | null {
  const m = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s+(.+)$/m.exec(texto);
  return m ? m[1].trim() : null;
}

/** Primeiro valor monetário depois de um rótulo (pode estar na linha seguinte). */
function valorDepoisDe(texto: string, rotulo: RegExp): number | null {
  const re = new RegExp(rotulo.source + '\\s*([\\d.]+,\\d{2})');
  const m = re.exec(texto);
  return m ? parseValor(m[1]) : null;
}

function numeroDepoisDe(texto: string, re: RegExp): number | null {
  const m = re.exec(texto);
  return m ? Number(m[1]) : null;
}

/** Conteúdo da linha seguinte a um rótulo isolado. */
function depoisDoRotulo(texto: string, rotulo: string): string | null {
  const linhas = texto.split('\n').map((l) => l.trim());
  const i = linhas.findIndex((l) => l === rotulo);
  return i >= 0 && linhas[i + 1] ? linhas[i + 1] : null;
}

function somaDosItens(itens: ItemGuiaLido[]): number {
  return arredondar(itens.reduce((s, i) => s + i.valor, 0));
}

/** "4.310,76" → 4310.76 */
export function parseValor(bruto: string): number {
  return arredondar(Number(bruto.replace(/\./g, '').replace(',', '.')));
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Confere se a soma dos itens bate com o total impresso. Diferença aqui quer
 * dizer que o leitor perdeu (ou inventou) uma linha — e é melhor a pessoa saber
 * disso antes de gravar do que o gráfico mentir depois.
 */
export function conferir(guia: GuiaLida): string | null {
  if (guia.itens.length === 0) return 'Não achei nenhum item na composição.';
  const soma = somaDosItens(guia.itens);
  if (Math.abs(soma - guia.valorTotal) < 0.01) return null;
  return `A soma dos itens (${soma.toFixed(2)}) não bate com o total do documento (${guia.valorTotal.toFixed(2)}).`;
}
