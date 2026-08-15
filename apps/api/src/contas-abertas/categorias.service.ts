import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CategoriaDespesa } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Uma categoria com quantas contas já foram etiquetadas com ela. */
export interface CategoriaComUso extends CategoriaDespesa {
  emUso: number;
}

/**
 * O cadastro de "com o que a empresa gasta".
 *
 * Categoria não se apaga quando já etiquetou alguma conta: relatório de mês
 * fechado não pode mudar porque alguém arrumou o cadastro depois. O caminho é
 * desativar — some das opções novas e o que já foi classificado continua de pé.
 */
@Injectable()
export class CategoriasService {
  private readonly logger = new Logger(CategoriasService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listar(incluirInativas = false): Promise<CategoriaComUso[]> {
    const categorias = await this.prisma.categoriaDespesa.findMany({
      where: incluirInativas ? undefined : { ativa: true },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: { _count: { select: { classificacoes: true } } },
    });

    return categorias.map(({ _count, ...c }) => ({
      ...c,
      emUso: _count.classificacoes,
    }));
  }

  async criar(nome: string): Promise<CategoriaDespesa> {
    const limpo = nome.trim();
    if (limpo.length < 2) {
      throw new BadRequestException('O nome da categoria é curto demais.');
    }
    await this.recusarNomeRepetido(limpo);

    // Entra no fim da lista; reordenar é assunto de outra tela, se um dia
    // fizer falta.
    const ultima = await this.prisma.categoriaDespesa.findFirst({
      orderBy: { ordem: 'desc' },
      select: { ordem: true },
    });

    this.logger.log(`Categoria de despesa criada: ${limpo}`);
    return this.prisma.categoriaDespesa.create({
      data: { nome: limpo, ordem: (ultima?.ordem ?? 0) + 1 },
    });
  }

  async atualizar(
    id: string,
    dados: { nome?: string; ativa?: boolean },
  ): Promise<CategoriaDespesa> {
    const atual = await this.prisma.categoriaDespesa.findUnique({
      where: { id },
    });
    if (!atual) throw new NotFoundException('Categoria não encontrada');

    const nome = dados.nome?.trim();
    if (nome !== undefined) {
      if (nome.length < 2) {
        throw new BadRequestException('O nome da categoria é curto demais.');
      }
      if (nome.toLowerCase() !== atual.nome.toLowerCase()) {
        await this.recusarNomeRepetido(nome);
      }
    }

    return this.prisma.categoriaDespesa.update({
      where: { id },
      data: {
        ...(nome === undefined ? {} : { nome }),
        ...(dados.ativa === undefined ? {} : { ativa: dados.ativa }),
      },
    });
  }

  /**
   * Apaga — só a que nunca etiquetou nada. Com uso, o pedido vira a orientação
   * de desativar, porque apagar reescreveria o passado.
   */
  async remover(id: string): Promise<void> {
    const usos = await this.prisma.classificacaoConta.count({
      where: { categoriaId: id },
    });
    if (usos > 0) {
      throw new BadRequestException(
        `Esta categoria já classifica ${usos} conta(s). Desative-a em vez de ` +
          'apagar — assim ela some das opções novas sem mexer no que já foi ' +
          'classificado.',
      );
    }
    const existe = await this.prisma.categoriaDespesa.findUnique({
      where: { id },
    });
    if (!existe) throw new NotFoundException('Categoria não encontrada');

    await this.prisma.categoriaDespesa.delete({ where: { id } });
  }

  /**
   * Etiqueta um título do IXC. `categoriaId` vazio tira a etiqueta — quem
   * classificou errado precisa poder desfazer sem escolher outra à toa.
   */
  async classificar(
    idFnApagar: number,
    categoriaId: string | null,
    usuarioId?: string,
  ): Promise<void> {
    if (!categoriaId) {
      await this.prisma.classificacaoConta.deleteMany({
        where: { idFnApagar },
      });
      return;
    }

    const categoria = await this.prisma.categoriaDespesa.findUnique({
      where: { id: categoriaId },
    });
    if (!categoria) throw new NotFoundException('Categoria não encontrada');

    await this.prisma.classificacaoConta.upsert({
      where: { idFnApagar },
      create: { idFnApagar, categoriaId, classificadoPor: usuarioId ?? null },
      update: { categoriaId, classificadoPor: usuarioId ?? null },
    });
  }

  /**
   * A mesma etiqueta em vários títulos de uma vez.
   *
   * Apagar as antigas e regravar num lote só, dentro de uma transação, em vez
   * de um upsert por título: são duas idas ao banco em vez de duas por conta, e
   * ninguém lê o meio do caminho — a lista que esta tela classifica é a mesma
   * que alimenta o painel, e metade classificada seria número errado nos dois
   * lugares. Devolve quantos títulos ficaram etiquetados.
   */
  async classificarEmLote(
    idsFnApagar: number[],
    categoriaId: string | null,
    usuarioId?: string,
  ): Promise<number> {
    const ids = [...new Set(idsFnApagar)];
    if (ids.length === 0) return 0;

    if (!categoriaId) {
      const { count } = await this.prisma.classificacaoConta.deleteMany({
        where: { idFnApagar: { in: ids } },
      });
      this.logger.log(`Etiqueta retirada de ${count} conta(s).`);
      return count;
    }

    const categoria = await this.prisma.categoriaDespesa.findUnique({
      where: { id: categoriaId },
    });
    if (!categoria) throw new NotFoundException('Categoria não encontrada');

    await this.prisma.$transaction([
      this.prisma.classificacaoConta.deleteMany({
        where: { idFnApagar: { in: ids } },
      }),
      this.prisma.classificacaoConta.createMany({
        data: ids.map((idFnApagar) => ({
          idFnApagar,
          categoriaId,
          classificadoPor: usuarioId ?? null,
        })),
      }),
    ]);

    this.logger.log(
      `${ids.length} conta(s) classificadas como "${categoria.nome}".`,
    );
    return ids.length;
  }

  /** As etiquetas de um punhado de títulos, para a listagem. */
  async dosTitulos(ids: number[]): Promise<Map<number, CategoriaDespesa>> {
    if (ids.length === 0) return new Map();

    const classificadas = await this.prisma.classificacaoConta.findMany({
      where: { idFnApagar: { in: ids } },
      include: { categoria: true },
    });
    return new Map(classificadas.map((c) => [c.idFnApagar, c.categoria]));
  }

  private async recusarNomeRepetido(nome: string): Promise<void> {
    const repetida = await this.prisma.categoriaDespesa.findFirst({
      where: { nome: { equals: nome, mode: 'insensitive' } },
    });
    if (repetida) {
      throw new BadRequestException(`Já existe a categoria "${repetida.nome}".`);
    }
  }
}
