import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TipoLancamento } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContasPagarService } from './contas-pagar.service';
import { CriarPagamentoAvulsoDto } from './dto/avulso.dto';

/**
 * Pagamentos avulsos: para alguém sem cadastro de funcionário (ex.: patrocínio).
 * Cria/usa um beneficiário avulso e gera a conta a pagar correspondente.
 */
@Injectable()
export class AvulsosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contasPagar: ContasPagarService,
  ) {}

  listarBeneficiarios(busca?: string) {
    return this.prisma.beneficiarioAvulso.findMany({
      where: busca
        ? { nome: { contains: busca, mode: 'insensitive' } }
        : undefined,
      orderBy: { nome: 'asc' },
      take: 100,
    });
  }

  async criarPagamento(dto: CriarPagamentoAvulsoDto, usuarioId?: string) {
    const beneficiarioId = await this.resolverBeneficiario(dto);

    const [conta] = await this.contasPagar.criar(
      {
        itens: [
          {
            beneficiarioAvulsoId: beneficiarioId,
            tipo: TipoLancamento.AVULSO,
            valor: dto.valor,
            contaContabil: dto.contaContabil,
            observacao: dto.observacao,
          },
        ],
      },
      usuarioId,
    );
    return conta;
  }

  private async resolverBeneficiario(
    dto: CriarPagamentoAvulsoDto,
  ): Promise<string> {
    if (dto.beneficiarioAvulsoId) {
      const existe = await this.prisma.beneficiarioAvulso.findUnique({
        where: { id: dto.beneficiarioAvulsoId },
        select: { id: true },
      });
      if (!existe) throw new NotFoundException('Beneficiário não encontrado');
      return existe.id;
    }
    if (!dto.nome) {
      throw new BadRequestException(
        'Informe o nome do beneficiário ou um beneficiarioAvulsoId',
      );
    }
    const novo = await this.prisma.beneficiarioAvulso.create({
      data: {
        nome: dto.nome,
        cpfCnpj: dto.cpfCnpj ?? null,
        tipoPessoa: dto.tipoPessoa ?? 'F',
        chavePix: dto.chavePix ?? null,
        cidadeIxc: dto.cidadeIxc ?? null,
      },
    });
    return novo.id;
  }
}
