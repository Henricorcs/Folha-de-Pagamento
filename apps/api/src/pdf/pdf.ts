/**
 * Extração do conteúdo de um PDF, sem depender de nada nativo.
 *
 * Duas saídas, porque há dois tipos de papel a ler:
 *
 * - `extrairTextoPdf` remonta as linhas. É o que as guias de imposto precisam:
 *   elas se ancoram em rótulos impressos ("Total da Guia:", "Identificador"),
 *   que só existem se a linha vier inteira e com os espaços nos lugares certos.
 * - `extrairItensPdf` devolve cada pedaço com a posição em que foi desenhado.
 *   É o que uma **tabela** precisa: na previsão de férias o nome e o cargo saem
 *   colados ("MARCUS VINICIUS PIMENTEL BANDEIRATECNICO INSTALADOR") porque as
 *   colunas se encostam, e só a posição separa uma da outra.
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

/**
 * O pdfjs é uma biblioteca de navegador: assim que é importada ela já executa
 * `new DOMMatrix()` no corpo do módulo de desenho — antes de qualquer PDF ser
 * aberto. No Node esse nome não existe, e a saída que a biblioteca conhece é
 * carregar o @napi-rs/canvas, 37 MB de binário nativo que ela puxa sozinha como
 * dependência opcional. Esse `require` acontece lá dentro, fora do nosso
 * try/catch, e é o único código nativo no caminho de ler uma guia — o mesmo
 * pacote que já apareceu quando a API não subia no container.
 *
 * Aqui nada é rasterizado: só sai texto. Então basta que os nomes existam no
 * ambiente. Definindo-os antes do import, o pdfjs se dá por satisfeito e nunca
 * procura o canvas — mesma coisa no Windows do desenvolvimento e no container.
 */
function prepararAmbienteDeNavegador(): void {
  const globais = globalThis as unknown as Record<string, unknown>;
  globais.DOMMatrix ??= class DOMMatrix {};
  globais.ImageData ??= class ImageData {};
  globais.Path2D ??= class Path2D {};
}

let modulo: Promise<ModuloPdfjs> | null = null;

/** Carrega o pdfjs uma vez só — são dezenas de MB de JavaScript. */
function carregarPdfjs(): Promise<ModuloPdfjs> {
  if (!modulo) {
    prepararAmbienteDeNavegador();
    modulo = importarEsm('pdfjs-dist/legacy/build/pdf.mjs');
  }
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
 * Um pedaço de texto e onde ele foi desenhado.
 *
 * `linha` e `coluna` são os dois eixos da matriz do PDF, batizados pelo papel
 * que cumprem: pedaços com a mesma `linha` estão na mesma altura da folha, e
 * `coluna` cresce ao longo dela. Qual dos dois eixos da matriz é qual depende
 * da rotação da página — relatório em paisagem, como a previsão de férias, sai
 * girado —, e é por isso que os nomes não são "x" e "y".
 */
export interface ItemDoPdf {
  texto: string;
  linha: number;
  coluna: number;
  /** Comprimento do pedaço no eixo das colunas. */
  largura: number;
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

/** Abre o PDF e entrega os pedaços de cada página, já em ordem de desenho. */
async function lerPaginas<T>(
  dados: Uint8Array,
  daPagina: (pedacos: PedacoDeTexto[]) => T,
): Promise<T[]> {
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
    const paginas: T[] = [];
    for (let n = 1; n <= documento.numPages; n++) {
      const pagina = await documento.getPage(n);
      const conteudo = await pagina.getTextContent();
      paginas.push(daPagina(conteudo.items as PedacoDeTexto[]));
      pagina.cleanup();
    }
    return paginas;
  } finally {
    await documento.destroy();
  }
}

export async function extrairTextoPdf(dados: Uint8Array): Promise<string> {
  const paginas = await lerPaginas(dados, montarLinhas);
  return paginas.join('\n');
}

/**
 * Os pedaços de texto com a posição de cada um, de todas as páginas.
 *
 * Páginas seguintes entram com a `linha` deslocada, para que a linha 3 da
 * página 2 não se misture com a linha 3 da página 1 — o relatório de férias
 * passa de uma página assim que a empresa cresce.
 */
export async function extrairItensPdf(
  dados: Uint8Array,
): Promise<ItemDoPdf[]> {
  const porPagina = await lerPaginas(dados, converterItens);

  const todos: ItemDoPdf[] = [];
  let deslocamento = 0;
  for (const itens of porPagina) {
    for (const item of itens) {
      todos.push({ ...item, linha: item.linha + deslocamento });
    }
    const maior = itens.reduce((m, i) => Math.max(m, i.linha), 0);
    deslocamento += maior + 1000;
  }
  return todos;
}

function converterItens(pedacos: PedacoDeTexto[]): ItemDoPdf[] {
  const itens: ItemDoPdf[] = [];
  for (const pedaco of pedacos) {
    if (typeof pedaco?.str !== 'string') continue;
    const texto = pedaco.str.trim();
    if (!texto) continue;
    itens.push({
      texto,
      linha: pedaco.transform?.[4] ?? 0,
      coluna: pedaco.transform?.[5] ?? 0,
      largura: pedaco.width ?? 0,
    });
  }
  return itens;
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
