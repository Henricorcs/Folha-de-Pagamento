import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { extrairPaginasPdf } from '../pdf/pdf';
import { PrismaService } from '../prisma/prisma.service';
import { conferirArquivo, lerDataUrl, soDigitos } from './documentos.service';
import { chaveDoNome, lerRecibos, type ReciboLido } from './recibos.parse';

/** O tipo com que o recibo entra na pasta. Fixo: é o que o mês seguinte procura. */
export const TIPO_RECIBO = 'Recibo de pagamento';

/**
 * O PDF de recibos da folha, separado por pessoa.
 *
 * Todo mês a contabilidade manda um arquivo só com a folha inteira — uma página
 * por empregado. Guardado assim, ele responde "onde está a folha de julho?" e
 * não responde "onde está o recibo do Fulano?", que é a pergunta que se faz
 * dois anos depois, quando ele reclama de um valor.
 *
 * Aqui o arquivo é lido, cortado por dono e posto na pasta de cada um. Nada é
 * gravado antes de alguém conferir: a leitura devolve o que achou e para quem
 * vai, e é a tela que confirma. Um recibo na pasta errada é pior que um recibo
 * fora da pasta.
 */
@Injectable()
export class RecibosDaFolhaService {
  private readonly logger = new Logger(RecibosDaFolhaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lê o PDF e diz o que achou. Não grava nada.
   *
   * Devolve, para cada recibo, a pasta que ele acha ser a dona — por CPF
   * primeiro, que é o que não muda de grafia, e por nome quando não há CPF.
   */
  async analisar(arquivoDataUrl: string) {
    const conteudo = pdfDaDataUrl(arquivoDataUrl);
    const paginas = await extrairPaginasPdf(new Uint8Array(conteudo));
    const leitura = lerRecibos(paginas);

    if (leitura.recibos.length === 0) {
      throw new BadRequestException(
        'Não achei nenhum recibo neste PDF. Ele precisa ser o arquivo de ' +
          'recibos de pagamento da contabilidade, com um empregado por página.',
      );
    }
    if (!leitura.competencia) {
      throw new BadRequestException(
        'Não achei a competência impressa no PDF, e sem ela o recibo entraria ' +
          'na pasta sem dizer de que mês é.',
      );
    }

    const pastas = await this.pastasParaCasar();
    const jaGuardados = await this.prisma.documentoRh.findMany({
      where: { tipo: TIPO_RECIBO, competencia: leitura.competencia },
      select: { pastaId: true },
    });
    const jaTem = new Set(jaGuardados.map((d) => d.pastaId));

    return {
      competencia: leitura.competencia,
      competenciaEscrita: leitura.competenciaEscrita,
      totalDePaginas: paginas.length,
      paginasSemDono: leitura.paginasSemDono,
      itens: leitura.recibos.map((r) => {
        const pasta = casar(r, pastas);
        return {
          ...r,
          pastaId: pasta?.id ?? null,
          pastaNome: pasta?.nome ?? null,
          /** Como esta pasta foi encontrada, para a tela poder discordar. */
          casouPor: pasta?.por ?? null,
          /** Este mês já está guardado nesta pasta: entraria repetido. */
          jaGuardado: pasta ? jaTem.has(pasta.id) : false,
        };
      }),
    };
  }

  /**
   * Corta o PDF e guarda cada pedaço na pasta que foi confirmada.
   *
   * O arquivo volta inteiro nesta segunda ida de propósito: guardar o PDF do
   * meio do caminho em algum lugar do servidor entre uma chamada e outra seria
   * inventar estado para economizar 200 KB de rede.
   */
  async guardar(
    arquivoDataUrl: string,
    competencia: string,
    itens: Array<{ paginas: number[]; pastaId: string; nome: string }>,
    usuarioId?: string,
  ) {
    if (itens.length === 0) {
      throw new BadRequestException('Nenhum recibo foi marcado para guardar.');
    }

    const conteudo = pdfDaDataUrl(arquivoDataUrl);
    const original = await PDFDocument.load(conteudo, {
      ignoreEncryption: true,
    });

    const guardados: Array<{ pasta: string; nome: string }> = [];
    const pulados: Array<{ nome: string; motivo: string }> = [];

    for (const item of itens) {
      const paginas = [...new Set(item.paginas)].sort((a, b) => a - b);
      if (paginas.some((p) => p < 1 || p > original.getPageCount())) {
        pulados.push({ nome: item.nome, motivo: 'página fora do arquivo' });
        continue;
      }

      const pasta = await this.prisma.pastaRh.findUnique({
        where: { id: item.pastaId },
        select: { id: true, nome: true },
      });
      if (!pasta) {
        pulados.push({ nome: item.nome, motivo: 'a pasta não existe mais' });
        continue;
      }

      const recorte = await PDFDocument.create();
      const copiadas = await recorte.copyPages(
        original,
        paginas.map((p) => p - 1),
      );
      for (const p of copiadas) recorte.addPage(p);
      const bytes = await recorte.save();

      const mes = competencia.slice(5, 7);
      const ano = competencia.slice(0, 4);
      try {
        await this.prisma.documentoRh.create({
          data: {
            pastaId: pasta.id,
            titulo: `Recibo de pagamento ${mes}/${ano}`,
            tipo: TIPO_RECIBO,
            competencia,
            // O dia impresso é o do fechamento da folha, que não vem no papel;
            // o mês é o que identifica o documento, e ele está na competência.
            emitidoEm: null,
            arquivoNome: `recibo-${competencia}-${arquivoAmigavel(item.nome)}.pdf`,
            arquivoTipo: 'application/pdf',
            arquivoTamanho: bytes.length,
            // O `save()` do pdf-lib devolve `Uint8Array` sobre um buffer
            // genérico, e a coluna `Bytes` do Prisma quer um sobre
            // `ArrayBuffer`. Copiar aqui é o preço de não brigar com a
            // tipagem por um documento de algumas centenas de KB.
            arquivo: new Uint8Array(bytes),
            criadoPor: usuarioId ?? null,
          },
        });
        guardados.push({ pasta: pasta.nome, nome: item.nome });
      } catch (err) {
        /*
         * O índice único (pasta + tipo + competência) é a rede de segurança:
         * subir o mesmo PDF duas vezes é o engano mais provável deste fluxo, e
         * ele não pode encher a pasta de recibos repetidos do mesmo mês.
         */
        const repetido =
          err instanceof Error && /Unique constraint/i.test(err.message);
        pulados.push({
          nome: item.nome,
          motivo: repetido
            ? `já havia um recibo de ${mes}/${ano} na pasta`
            : 'o banco recusou',
        });
        if (!repetido) this.logger.warn(`Recibo de ${item.nome}: ${err}`);
      }
    }

    this.logger.log(
      `Recibos de ${competencia}: ${guardados.length} guardado(s), ` +
        `${pulados.length} pulado(s).`,
    );
    return { competencia, guardados, pulados };
  }

  /** As pastas com o que serve para reconhecer o dono de um recibo. */
  private async pastasParaCasar(): Promise<PastaParaCasar[]> {
    const pastas = await this.prisma.pastaRh.findMany({
      where: { daEmpresa: false },
      include: {
        funcionario: { select: { nome: true, apelido: true, cpfCnpj: true } },
      },
    });

    return pastas.map((p) => ({
      id: p.id,
      nome: p.funcionario?.nome ?? p.nome,
      cpf: p.cpf || soDigitos(p.funcionario?.cpfCnpj),
      nomes: [p.nome, p.funcionario?.nome, p.funcionario?.apelido]
        .filter((n): n is string => !!n)
        .map(chaveDoNome),
    }));
  }
}

interface PastaParaCasar {
  id: string;
  nome: string;
  cpf: string;
  nomes: string[];
}

/**
 * De quem é este recibo.
 *
 * CPF primeiro: é o que a contabilidade e o cadastro escrevem igual. O nome é o
 * plano B, e só vale inteiro — "José da Silva" não casa com "José da Silva
 * Júnior", que é outra pessoa e provavelmente trabalha na mesma casa.
 */
function casar(
  recibo: ReciboLido,
  pastas: PastaParaCasar[],
): { id: string; nome: string; por: 'cpf' | 'nome' } | null {
  if (recibo.cpf) {
    const porCpf = pastas.find((p) => p.cpf && p.cpf === recibo.cpf);
    if (porCpf) return { id: porCpf.id, nome: porCpf.nome, por: 'cpf' };
  }

  const chave = chaveDoNome(recibo.nome);
  const iguais = pastas.filter((p) => p.nomes.includes(chave));
  // Dois homônimos: quem decide é quem está olhando, não o desempate.
  if (iguais.length === 1) {
    return { id: iguais[0].id, nome: iguais[0].nome, por: 'nome' };
  }
  return null;
}

/** O PDF de dentro da data URL, conferido como PDF e como tamanho. */
function pdfDaDataUrl(url: string): Buffer {
  const { conteudo, tipoDoArquivo } = lerDataUrl(url);
  conferirArquivo(conteudo, tipoDoArquivo);
  if (tipoDoArquivo !== 'application/pdf') {
    throw new BadRequestException(
      'O arquivo de recibos precisa ser o PDF que a contabilidade manda.',
    );
  }
  return conteudo;
}

/** O nome da pessoa como pedaço de nome de arquivo. */
function arquivoAmigavel(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
}
