/**
 * Extração do texto de um PDF, sem depender de nada nativo.
 *
 * O pdfjs devolve pedaços soltos de texto com a posição de cada um, e não
 * linhas. Remontá-las é o trabalho daqui — e é o que o leitor de guias espera:
 * ele se ancora em rótulos impressos ("Total da Guia:", "Identificador"), que
 * só existem se a linha vier inteira e com os espaços nos lugares certos.
 */

import * as path from 'node:path';

type ModuloPdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/**
 * O pdfjs só é publicado como ESM. Um `await import()` normal viraria
 * `require()` no build CommonJS do Nest e estouraria em tempo de execução; o
 * `Function` esconde o import do TypeScript, que então não o reescreve.
 */
const importarEsm = new Function(
  'caminho',
  'return import(caminho)',
) as (caminho: string) => Promise<ModuloPdfjs>;

let modulo: Promise<ModuloPdfjs> | null = null;

/** Carrega o pdfjs uma vez só — são dezenas de MB de JavaScript. */
function carregarPdfjs(): Promise<ModuloPdfjs> {
  if (!modulo) modulo = importarEsm('pdfjs-dist/legacy/build/pdf.mjs');
  return modulo;
}

/**
 * Distância horizontal, em unidades do PDF, a partir da qual dois pedaços de
 * texto viram palavras separadas.
 *
 * Baixo demais quebra palavra no meio ("Arrecada ção"); alto demais cola
 * colunas vizinhas ("11222333" + "07/2026"). Um quinto da altura da fonte fica
 * bem no meio: menor que qualquer espaço de verdade, maior que a folga entre
 * duas letras da mesma palavra.
 */
const FRACAO_DA_ALTURA = 0.2;

interface PedacoDeTexto {
  str: string;
  width: number;
  height: number;
  hasEOL: boolean;
  transform: number[];
}

/**
 * Fontes-padrão do próprio pacote. Não mudam o texto extraído, mas sem elas o
 * pdfjs enche o log de aviso a cada arquivo lido — e log sujo atrapalha
 * justamente quando algo dá errado de verdade.
 */
function pastaDasFontes(): string {
  const raiz = path.dirname(require.resolve('pdfjs-dist/package.json'));
  // Barra normal e no fim, sempre: o pdfjs trata isto como URL, então a
  // contrabarra do Windows é recusada.
  return `${path.join(raiz, 'standard_fonts').replace(/\\/g, '/')}/`;
}

export async function extrairTextoPdf(dados: Uint8Array): Promise<string> {
  const { getDocument } = await carregarPdfjs();

  const documento = await getDocument({
    data: dados,
    // Nada de rede nem de fonte do sistema: é um servidor lendo um boleto.
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: pastaDasFontes(),
  }).promise;

  try {
    const paginas: string[] = [];
    for (let n = 1; n <= documento.numPages; n++) {
      const pagina = await documento.getPage(n);
      const conteudo = await pagina.getTextContent();
      paginas.push(montarLinhas(conteudo.items as PedacoDeTexto[]));
      pagina.cleanup();
    }
    return paginas.join('\n');
  } finally {
    await documento.destroy();
  }
}

/**
 * Junta os pedaços de volta em linhas. O `hasEOL` do pdfjs diz onde a linha
 * termina; o espaço entre um pedaço e o seguinte é deduzido da distância entre
 * eles, porque o PDF não guarda espaço nenhum — guarda posição.
 */
function montarLinhas(pedacos: PedacoDeTexto[]): string {
  const linhas: string[] = [];
  let linha = '';
  let fimDoAnterior: number | null = null;

  for (const pedaco of pedacos) {
    if (typeof pedaco?.str !== 'string') continue;

    const inicio = pedaco.transform?.[4] ?? 0;
    const folga = Math.max(pedaco.height ?? 0, 1) * FRACAO_DA_ALTURA;

    if (
      linha &&
      fimDoAnterior !== null &&
      inicio - fimDoAnterior > folga &&
      !linha.endsWith(' ') &&
      !pedaco.str.startsWith(' ')
    ) {
      linha += ' ';
    }

    linha += pedaco.str;
    fimDoAnterior = inicio + (pedaco.width ?? 0);

    if (pedaco.hasEOL) {
      linhas.push(linha.trim());
      linha = '';
      fimDoAnterior = null;
    }
  }

  if (linha.trim()) linhas.push(linha.trim());
  return linhas.join('\n');
}
