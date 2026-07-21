import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LancamentoFixoDto } from './dto/lancamento-fixo.dto';
import { QueryFuncionariosDto } from './dto/query-funcionarios.dto';
import { UpdateFuncionarioDto } from './dto/update-funcionario.dto';

@Injectable()
export class FuncionariosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(q: QueryFuncionariosDto) {
    const where: Prisma.FuncionarioWhereInput = {};

    if (q.busca) {
      where.OR = [
        { nome: { contains: q.busca, mode: 'insensitive' } },
        { cpfCnpj: { contains: q.busca, mode: 'insensitive' } },
        { email: { contains: q.busca, mode: 'insensitive' } },
      ];
    }
    if (q.ativo === 'true') where.ativo = true;
    if (q.ativo === 'false') where.ativo = false;

    const [total, itens] = await this.prisma.$transaction([
      this.prisma.funcionario.count({ where }),
      this.prisma.funcionario.findMany({
        where,
        orderBy: { nome: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    return {
      itens,
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  async buscarPorId(id: string) {
    const func = await this.prisma.funcionario.findUnique({
      where: { id },
      include: {
        adiantamentos: { orderBy: { data: 'desc' }, take: 20 },
        lancamentosFixos: { orderBy: [{ tipo: 'asc' }, { descricao: 'asc' }] },
      },
    });
    if (!func) throw new NotFoundException('Funcionário não encontrado');
    return func;
  }

  async atualizar(id: string, dto: UpdateFuncionarioDto) {
    await this.assertExiste(id);
    return this.prisma.funcionario.update({
      where: { id },
      data: {
        observacoes: dto.observacoes,
        chavePix: dto.chavePix,
        banco: dto.banco,
        agencia: dto.agencia,
        conta: dto.conta,
        ativo: dto.ativo,
        carteiraAssinada: dto.carteiraAssinada,
        recebeAdiantamento: dto.recebeAdiantamento,
        cidadeIxc: dto.cidadeIxc,
        ...(dto.salarioBase !== undefined
          ? { salarioBase: new Prisma.Decimal(dto.salarioBase) }
          : {}),
      },
    });
  }

  // --- Lançamentos fixos (descontos/adiantamentos/bônus recorrentes) ---
  async listarLancamentos(funcionarioId: string) {
    await this.assertExiste(funcionarioId);
    return this.prisma.lancamentoFixo.findMany({
      where: { funcionarioId },
      orderBy: [{ tipo: 'asc' }, { descricao: 'asc' }],
    });
  }

  async criarLancamento(funcionarioId: string, dto: LancamentoFixoDto) {
    await this.assertExiste(funcionarioId);
    return this.prisma.lancamentoFixo.create({
      data: {
        funcionarioId,
        tipo: dto.tipo,
        descricao: dto.descricao,
        valor: new Prisma.Decimal(dto.valor),
        ativo: dto.ativo ?? true,
      },
    });
  }

  async atualizarLancamento(lancamentoId: string, dto: LancamentoFixoDto) {
    await this.assertLancamentoExiste(lancamentoId);
    return this.prisma.lancamentoFixo.update({
      where: { id: lancamentoId },
      data: {
        tipo: dto.tipo,
        descricao: dto.descricao,
        valor: new Prisma.Decimal(dto.valor),
        ativo: dto.ativo,
      },
    });
  }

  async removerLancamento(lancamentoId: string) {
    await this.assertLancamentoExiste(lancamentoId);
    await this.prisma.lancamentoFixo.delete({ where: { id: lancamentoId } });
  }

  private async assertLancamentoExiste(id: string) {
    const existe = await this.prisma.lancamentoFixo.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Lançamento não encontrado');
  }

  /** Resumo para dashboard: total, ativos, folha base mensal. */
  async resumo() {
    const [total, ativos, agg] = await this.prisma.$transaction([
      this.prisma.funcionario.count(),
      this.prisma.funcionario.count({ where: { ativo: true } }),
      this.prisma.funcionario.aggregate({
        where: { ativo: true },
        _sum: { salarioBase: true },
      }),
    ]);
    return {
      total,
      ativos,
      inativos: total - ativos,
      folhaBaseMensal: agg._sum.salarioBase ?? new Prisma.Decimal(0),
    };
  }

  private async assertExiste(id: string) {
    const existe = await this.prisma.funcionario.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Funcionário não encontrado');
  }
}
