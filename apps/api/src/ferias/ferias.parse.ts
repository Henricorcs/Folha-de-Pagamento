/**
 * Leitura da "Previsão de Férias" que a contabilidade manda todo mês.
 *
 * O relatório é uma tabela em paisagem, uma linha por empregado:
 *
 *   Código | Empregado | Cargo | Admissão | Período Aquisitivo | Direito |
 *   Dias Direito em <data> | Restam | Data Limite | Faltam Dias/(Meses)
 *
 * Ler isso do texto corrido não dá: as colunas se encostam e o PDF não guarda
 * espaço nenhum, então nome e cargo saem grudados ("MARCUS VINICIUS PIMENTEL
 * BANDEIRATECNICO INSTALADOR") e as datas se colam nos números. Por isso a
 * leitura é feita sobre os pedaços posicionados (ver `ItemDoPdf`): quem está na
 * mesma altura é a mesma pessoa, e a ordem das colunas vem da posição.
 *
 * Dentro da linha, cada célula é reconhecida **pelo que ela é** — código é só
 * dígito, período aquisitivo é "data a data", as duas datas soltas se
 * distinguem por serem anteriores ou posteriores ao período — e não pela
 * posição exata das colunas. Uma versão do relatório com as colunas em outra
 * largura continua sendo lida.
 */
import type { ItemDoPdf } from '../pdf/pdf';

/** O PDF não é o que a gente esperava — a tela mostra isto e ninguém grava. */
export class PrevisaoIlegivelError extends Error {}

/** Uma pessoa na fila de férias, como o relatório a descreve. */
export interface ItemDePrevisao {
  /** Posição no PDF, de cima para baixo. */
  ordem: number;
  /** Matrícula na contabilidade ("000055"). */
  codigo: string;
  nome: string;
  cargo: string | null;
  admissao: Date | null;
  /** Os 12 meses trabalhados que dão direito às férias. */
  periodoInicio: Date;
  periodoFim: Date;
  /**
   * Último dia em que as férias podem **começar** sem a empresa cair no
   * pagamento em dobro (art. 137 da CLT). É a data que governa a fila.
   */
  dataLimite: Date;
  /** Dias a que a pessoa tem (ou terá) direito — 30 no caso normal. */
  diasDireito: number;
  /** Dias já acumulados na data do relatório (2,5 por mês trabalhado). */
  diasAcumulados: number | null;
  /** Dias que ainda restam para gozar deste período. */
  diasRestantes: number | null;
}

export interface PrevisaoLida {
  /** Dia a que o relatório se refere — as contas dele partem daqui. */
  dataRelatorio: Date;
  empresa: string | null;
  cnpj: string | null;
  /** "Nº de Meses Limite" do cabeçalho. */
  mesesLimite: number | null;
  itens: ItemDePrevisao[];
  /** Quantos empregados o rodapé do relatório diz que existem. */
  totalDeclarado: number | null;
}

const DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const PERIODO = /^(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})$/;
const CODIGO = /^\d{3,10}$/;
const DECIMAL = /^\d{1,4}(?:,\d+)?$/;

/**
 * Pedaços na mesma altura da folha são da mesma linha. A folga existe porque o
 * cabeçalho desenha o rótulo em duas alturas quase iguais ("Direito" e
 * "(Dias)"), enquanto as linhas de empregado ficam bem mais distantes entre si.
 */
const FOLGA_DA_LINHA = 5;

export function lerPrevisaoDeFerias(itens: ItemDoPdf[]): PrevisaoLida {
  const linhas = agruparEmLinhas(itens);

  const dataRelatorio = acharDataDoRelatorio(itens);
  if (!dataRelatorio) {
    throw new PrevisaoIlegivelError(
      'Não achei o período do relatório neste PDF. Ele é mesmo a "Previsão de Férias" da contabilidade?',
    );
  }

  const lidos: ItemDePrevisao[] = [];
  for (const linha of linhas) {
    const item = lerLinha(linha, lidos.length + 1);
    if (item) lidos.push(item);
  }

  if (lidos.length === 0) {
    throw new PrevisaoIlegivelError(
      'Li o cabeçalho, mas nenhuma linha de empregado. Se o PDF for digitalizado (uma foto dentro do arquivo), peça o original à contabilidade.',
    );
  }

  const { empresa, cnpj } = acharEmpresa(itens);
  return {
    dataRelatorio,
    empresa,
    cnpj,
    mesesLimite: acharMesesLimite(itens),
    itens: lidos,
    totalDeclarado: acharTotalDeclarado(itens),
  };
}

/** Diferença entre o que foi lido e o que o rodapé declara (null = bate). */
export function conferir(previsao: PrevisaoLida): string | null {
  const { totalDeclarado, itens } = previsao;
  if (totalDeclarado === null || totalDeclarado === itens.length) return null;
  return `O relatório diz ter ${totalDeclarado} empregado(s), e eu li ${itens.length}.`;
}

/**
 * Junta os pedaços que estão na mesma altura da folha, de cima para baixo, e
 * ordena cada linha pela posição ao longo dela.
 */
function agruparEmLinhas(itens: ItemDoPdf[]): ItemDoPdf[][] {
  const ordenados = [...itens].sort((a, b) => a.linha - b.linha);

  const linhas: ItemDoPdf[][] = [];
  let atual: ItemDoPdf[] = [];
  let altura: number | null = null;

  for (const item of ordenados) {
    if (altura === null || Math.abs(item.linha - altura) <= FOLGA_DA_LINHA) {
      altura ??= item.linha;
      atual.push(item);
    } else {
      linhas.push(atual);
      atual = [item];
      altura = item.linha;
    }
  }
  if (atual.length) linhas.push(atual);

  return linhas.map((l) => [...l].sort((a, b) => a.coluna - b.coluna));
}

/**
 * Uma linha da tabela, se for de empregado. Cabeçalho, rodapé e a faixa do
 * título não têm código + período aquisitivo, e caem fora sozinhos.
 */
function lerLinha(linha: ItemDoPdf[], ordem: number): ItemDePrevisao | null {
  const textos = linha.map((i) => i.texto);

  const periodoBruto = textos.find((t) => PERIODO.test(t));
  if (!periodoBruto) return null;
  const periodo = PERIODO.exec(periodoBruto);
  if (!periodo) return null;
  const periodoInicio = parseData(periodo[1]);
  const periodoFim = parseData(periodo[2]);
  if (!periodoInicio || !periodoFim) return null;

  const posicaoDoCodigo = textos.findIndex((t) => CODIGO.test(t));
  if (posicaoDoCodigo < 0) return null;
  const codigo = textos[posicaoDoCodigo];
  // Fora o código, para uma matrícula curta ("055") não ser confundida com uma
  // contagem de dias.
  const resto = textos.filter((_, i) => i !== posicaoDoCodigo);

  // As duas datas soltas são admissão e data limite. Elas se distinguem sem
  // depender da coluna: ninguém é admitido depois do período aquisitivo que
  // trabalhou, e a data limite é sempre posterior ao fim dele.
  const soltas = resto
    .filter((t) => DATA.test(t))
    .map(parseData)
    .filter((d): d is Date => d !== null);
  const admissao = soltas.find((d) => d.getTime() <= periodoInicio.getTime());
  const limiteDoPdf = soltas.find((d) => d.getTime() > periodoFim.getTime());

  // "30,0", "27,5": direito, acumulado até a data do relatório e restante,
  // nessa ordem ao longo da linha. Só o primeiro é indispensável.
  const decimais = resto.filter((t) => DECIMAL.test(t)).map(parseDecimal);
  const diasDireito = decimais[0] ?? 30;

  const nomeECargo = resto.filter(
    (t) =>
      !DATA.test(t) &&
      !PERIODO.test(t) &&
      !DECIMAL.test(t) &&
      /[A-Za-zÀ-ÿ]/.test(t),
  );
  const nome = nomeECargo[0];
  if (!nome) return null;

  return {
    ordem,
    codigo,
    nome: limpar(nome),
    cargo: nomeECargo[1] ? limpar(nomeECargo[1]) : null,
    admissao: admissao ?? null,
    periodoInicio,
    periodoFim,
    // Sem a coluna no relatório, a data limite é calculada: é a conta da lei,
    // não um palpite (ver `calcularDataLimite`).
    dataLimite: limiteDoPdf ?? calcularDataLimite(periodoFim, diasDireito),
    diasDireito,
    diasAcumulados: decimais.length >= 3 ? decimais[1] : null,
    diasRestantes: decimais.length >= 2 ? decimais[decimais.length - 1] : null,
  };
}

/**
 * Último dia para as férias começarem: o período concessivo são os 12 meses
 * seguintes ao aquisitivo, e os dias de férias têm de caber dentro dele.
 *
 * Confere com o que a contabilidade imprime: período que fecha em 23/11/2025 e
 * 30 dias de direito dão limite 24/10/2026. Só entra em cena quando a coluna
 * "Data Limite" não vier no PDF — quando vier, quem manda é o relatório.
 */
export function calcularDataLimite(periodoFim: Date, dias: number): Date {
  const limite = new Date(periodoFim.getTime());
  limite.setUTCFullYear(limite.getUTCFullYear() + 1);
  limite.setUTCDate(limite.getUTCDate() - Math.max(Math.round(dias), 0));
  return limite;
}

function acharDataDoRelatorio(itens: ItemDoPdf[]): Date | null {
  for (const { texto } of itens) {
    const m = /Per[íi]odo:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(texto);
    if (m) return parseData(m[1]);
  }
  return null;
}

function acharEmpresa(itens: ItemDoPdf[]): {
  empresa: string | null;
  cnpj: string | null;
} {
  for (const { texto } of itens) {
    const m = /^(.*?)\s*-\s*CNPJ:\s*([\d./-]+)/i.exec(texto);
    if (m) {
      return { empresa: limpar(m[1]) || null, cnpj: m[2].trim() || null };
    }
  }
  return { empresa: null, cnpj: null };
}

function acharMesesLimite(itens: ItemDoPdf[]): number | null {
  for (const { texto } of itens) {
    const m = /Meses\s+Limite:\s*(\d{1,2})/i.exec(texto);
    if (m) return Number(m[1]);
  }
  return null;
}

function acharTotalDeclarado(itens: ItemDoPdf[]): number | null {
  for (const { texto } of itens) {
    const m = /Total\s+Geral:\s*(\d+)/i.exec(texto);
    if (m) return Number(m[1]);
  }
  return null;
}

/** "24/11/2022" → meia-noite UTC daquele dia (data sem hora, sem fuso). */
export function parseData(texto: string): Date | null {
  const m = DATA.exec(texto.trim());
  if (!m) return null;
  const [, dia, mes, ano] = m;
  const data = new Date(
    Date.UTC(Number(ano), Number(mes) - 1, Number(dia), 0, 0, 0, 0),
  );
  return Number.isNaN(data.getTime()) ? null : data;
}

function parseDecimal(texto: string): number {
  return Number(texto.replace(',', '.'));
}

function limpar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}
