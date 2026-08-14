/**
 * O recibo em papel: o que sobra do pagamento em mãos quando alguém pergunta,
 * meses depois, se aquele dinheiro saiu mesmo.
 *
 * Tudo que sai impresso vem do retrato congelado em `assinaturas_diaria`, não
 * do cadastro de hoje. Reimprimir o recibo de março tem de dar o mesmo papel
 * que saiu em março, mesmo que o valor da diária tenha mudado desde então.
 */

import PDFDocument from 'pdfkit';
import { formatValorBR } from '../financeiro/folha.calc';
import { valorPorExtenso } from './recibo.extenso';

export interface DadosDoRecibo {
  /** Código do recibo, para achar este pagamento pelo papel */
  id: string;
  quemPaga: { nome: string; cnpj: string | null };
  quemRecebe: { nome: string; cpfCnpj: string | null };
  valor: number;
  descricao: string;
  detalhamento: string | null;
  dataDiaria: Date;
  assinadoEm: Date;
  assinaturaPng: string;
  ip: string | null;
  userAgent: string | null;
}

const MARGEM = 56;
const TINTA = '#1e293b';
const TINTA_FRACA = '#64748b';
const LINHA = '#cbd5e1';

export function gerarReciboPdf(d: DadosDoRecibo): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGEM, bottom: MARGEM, left: MARGEM, right: MARGEM },
    info: {
      Title: `Recibo — ${d.quemRecebe.nome}`,
      Author: d.quemPaga.nome,
      Subject: d.descricao,
    },
  });

  const pedacos: Buffer[] = [];
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (p: Buffer) => pedacos.push(p));
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);
  });

  desenhar(doc, d);
  doc.end();
  return pronto;
}

function desenhar(doc: PDFKit.PDFDocument, d: DadosDoRecibo): void {
  const largura = doc.page.width - MARGEM * 2;

  // --- Quem paga, no alto, como o timbre de um papel timbrado ---
  doc
    .fillColor(TINTA)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(d.quemPaga.nome.toUpperCase(), MARGEM, MARGEM);

  if (d.quemPaga.cnpj) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(TINTA_FRACA)
      .text(`CNPJ ${d.quemPaga.cnpj}`);
  }

  doc
    .moveTo(MARGEM, doc.y + 12)
    .lineTo(MARGEM + largura, doc.y + 12)
    .lineWidth(1)
    .strokeColor(LINHA)
    .stroke();

  // --- Título e valor: o que se lê de longe ---
  doc.moveDown(2);
  doc
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(TINTA)
    .text('RECIBO DE PAGAMENTO', { align: 'center', characterSpacing: 1.2 });

  doc.moveDown(1);
  doc
    .font('Helvetica-Bold')
    .fontSize(26)
    .text(formatValorBR(d.valor), { align: 'center' });

  // --- A declaração. É esta frase que a assinatura embaixo confirma ---
  doc.moveDown(1.8);
  doc.font('Helvetica').fontSize(11.5).fillColor(TINTA);

  const quitacao =
    `Recebi de ${d.quemPaga.nome}` +
    (d.quemPaga.cnpj ? `, inscrita no CNPJ sob o nº ${d.quemPaga.cnpj},` : ',') +
    ` a importância de ${formatValorBR(d.valor)} (${valorPorExtenso(d.valor)}), ` +
    `em dinheiro e em mãos, referente a ${d.descricao.trim()}, ` +
    `pelo serviço prestado em ${formatarData(d.dataDiaria)}, ` +
    'dando plena, geral e irrevogável quitação pelo valor recebido.';

  doc.text(quitacao, { align: 'justify', lineGap: 3.5 });

  if (d.detalhamento) {
    doc.moveDown(0.9);
    doc
      .fontSize(10)
      .fillColor(TINTA_FRACA)
      .text(`Composição do pagamento: ${d.detalhamento}.`, { lineGap: 2 });
  }

  // --- Quem recebeu, em duas linhas de conferência ---
  doc.moveDown(1.6);
  linhaDeDado(doc, 'Recebido por', d.quemRecebe.nome);
  if (d.quemRecebe.cpfCnpj) {
    linhaDeDado(doc, 'CPF/CNPJ', d.quemRecebe.cpfCnpj);
  }
  linhaDeDado(doc, 'Data do serviço', formatarData(d.dataDiaria));

  // --- A assinatura ---
  doc.moveDown(2.4);
  const topoAssinatura = doc.y;
  const larguraAssinatura = 260;
  const esquerda = MARGEM + (largura - larguraAssinatura) / 2;

  const png = Buffer.from(
    d.assinaturaPng.replace(/^data:image\/png;base64,/, ''),
    'base64',
  );
  // `fit` mantém a proporção do rabisco: a assinatura não pode ser esticada
  // para caber, ou deixa de parecer a assinatura da pessoa.
  doc.image(png, esquerda, topoAssinatura, {
    fit: [larguraAssinatura, 70],
    align: 'center',
  });

  const linhaY = topoAssinatura + 76;
  doc
    .moveTo(esquerda, linhaY)
    .lineTo(esquerda + larguraAssinatura, linhaY)
    .lineWidth(0.8)
    .strokeColor(TINTA)
    .stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .fillColor(TINTA)
    .text(d.quemRecebe.nome, esquerda, linhaY + 7, {
      width: larguraAssinatura,
      align: 'center',
    });

  if (d.quemRecebe.cpfCnpj) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(TINTA_FRACA)
      .text(`CPF/CNPJ ${d.quemRecebe.cpfCnpj}`, esquerda, doc.y + 1, {
        width: larguraAssinatura,
        align: 'center',
      });
  }

  // --- O rodapé é a prova técnica: de onde veio a assinatura ---
  rodape(doc, d);
}

/** "Rótulo: valor", alinhados como numa ficha. */
function linhaDeDado(
  doc: PDFKit.PDFDocument,
  rotulo: string,
  valor: string,
): void {
  doc.font('Helvetica').fontSize(10).fillColor(TINTA_FRACA).text(`${rotulo}: `, {
    continued: true,
  });
  doc.font('Helvetica-Bold').fillColor(TINTA).text(valor);
}

/**
 * O que responde "de onde saiu isto" se alguém contestar: quando foi assinado,
 * de que endereço, em que aparelho e o código que liga o papel ao registro.
 */
function rodape(doc: PDFKit.PDFDocument, d: DadosDoRecibo): void {
  const largura = doc.page.width - MARGEM * 2;
  const y = doc.page.height - MARGEM - 62;

  doc
    .moveTo(MARGEM, y)
    .lineTo(MARGEM + largura, y)
    .lineWidth(0.8)
    .strokeColor(LINHA)
    .stroke();

  const linhas = [
    `Assinado eletronicamente em ${formatarDataHora(d.assinadoEm)}.`,
    d.ip ? `Origem: ${d.ip}` : null,
    d.userAgent ? `Aparelho: ${encurtar(d.userAgent, 96)}` : null,
    `Recibo ${d.id}`,
  ].filter((l): l is string => l !== null);

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(TINTA_FRACA)
    .text(linhas.join('\n'), MARGEM, y + 8, { width: largura, lineGap: 1.5 });
}

function encurtar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

/** As datas do recibo são as do dia civil brasileiro, não as do fuso do servidor. */
function formatarData(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'UTC',
  }).format(d);
}

function formatarDataHora(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(d);
}
