import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TipoLancamento } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LancamentoDto } from './dto/lancamento.dto';
import { QueryFuncionariosDto } from './dto/query-funcionarios.dto';
import { UpdateFuncionarioDto } from './dto/update-funcionario.dto';
import { VariavelMesDto } from './dto/variavel-mes.dto';

@Injectable()
export class FuncionariosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(q: QueryFuncionariosDto) {
    const where: Prisma.FuncionarioWhereInput = {};

    // Funcionário é quem o filtro do IXC marcou (fornecedor ativo + ICMS
    // isento). Os demais cadastros ficam no banco, mas fora da listagem.
    if (q.todos !== 'true') where.isentoIcms = true;

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
        lancamentos: { orderBy: [{ competencia: 'desc' }, { tipo: 'asc' }] },
        variaveisMes: { orderBy: { competencia: 'desc' }, take: 12 },
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
        clt: dto.clt,
        carteiraAssinada: dto.carteiraAssinada,
        recebeAdiantamento: dto.recebeAdiantamento,
        cidadeIxc: dto.cidadeIxc,
        // 0 ou vazio limpa o valor: volta a valer o percentual da configuração.
        ...(dto.valorAdiantamento !== undefined
          ? {
              valorAdiantamento: dto.valorAdiantamento
                ? new Prisma.Decimal(dto.valorAdiantamento)
                : null,
            }
          : {}),
        // Mesma regra do adiantamento: 0/vazio limpa (a pessoa não comissiona).
        ...(dto.valorPorVenda !== undefined
          ? {
              valorPorVenda: dto.valorPorVenda
                ? new Prisma.Decimal(dto.valorPorVenda)
                : null,
            }
          : {}),
        ...(dto.salarioBase !== undefined
          ? { salarioBase: new Prisma.Decimal(dto.salarioBase) }
          : {}),
      },
    });
  }

  // --- Lançamentos (fixos = sem competência; avulsos = com competência) ---
  async listarLancamentos(funcionarioId: string) {
    await this.assertExiste(funcionarioId);
    return this.prisma.lancamento.findMany({
      where: { funcionarioId },
      orderBy: [{ competencia: 'desc' }, { tipo: 'asc' }],
    });
  }

  async criarLancamento(funcionarioId: string, dto: LancamentoDto) {
    await this.assertExiste(funcionarioId);
    return this.prisma.lancamento.create({
      data: {
        funcionarioId,
        tipo: dto.tipo,
        descricao: dto.descricao,
        valor: new Prisma.Decimal(dto.valor),
        ativo: dto.ativo ?? true,
        competencia: dto.competencia ?? null,
      },
    });
  }

  async atualizarLancamento(lancamentoId: string, dto: LancamentoDto) {
    await this.assertLancamentoExiste(lancamentoId);
    return this.prisma.lancamento.update({
      where: { id: lancamentoId },
      data: {
        tipo: dto.tipo,
        descricao: dto.descricao,
        valor: new Prisma.Decimal(dto.valor),
        ativo: dto.ativo,
        competencia: dto.competencia ?? null,
      },
    });
  }

  async removerLancamento(lancamentoId: string) {
    await this.assertLancamentoExiste(lancamentoId);
    await this.prisma.lancamento.delete({ where: { id: lancamentoId } });
  }

  // --- Variáveis do mês: vendas (comissão) e horas extras ---
  async listarVariaveis(funcionarioId: string) {
    await this.assertExiste(funcionarioId);
    return this.prisma.variavelMes.findMany({
      where: { funcionarioId },
      orderBy: { competencia: 'desc' },
    });
  }

  /** Um registro por competência: salvar de novo sobrescreve o mês. */
  async salvarVariaveis(funcionarioId: string, dto: VariavelMesDto) {
    await this.assertExiste(funcionarioId);
    const dados = {
      vendas: dto.vendas ?? 0,
      valorPorVenda:
        dto.valorPorVenda == null
          ? null
          : new Prisma.Decimal(dto.valorPorVenda),
      horasExtras: new Prisma.Decimal(dto.horasExtras ?? 0),
      observacao: dto.observacao ?? null,
    };
    return this.prisma.variavelMes.upsert({
      where: {
        funcionarioId_competencia: {
          funcionarioId,
          competencia: dto.competencia,
        },
      },
      create: { funcionarioId, competencia: dto.competencia, ...dados },
      update: dados,
    });
  }

  async removerVariaveis(funcionarioId: string, competencia: string) {
    await this.assertExiste(funcionarioId);
    await this.prisma.variavelMes.deleteMany({
      where: { funcionarioId, competencia },
    });
  }

  private async assertLancamentoExiste(id: string) {
    const existe = await this.prisma.lancamento.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Lançamento não encontrado');
  }

  /** Resumo para dashboard: total, ativos, folha base mensal. */
  async resumo() {
    // Conta o mesmo universo da listagem: só fornecedores isentos de ICMS.
    const funcionario = { isentoIcms: true };
    const [total, ativos, agg, bonus] = await this.prisma.$transaction([
      this.prisma.funcionario.count({ where: funcionario }),
      this.prisma.funcionario.count({ where: { ...funcionario, ativo: true } }),
      this.prisma.funcionario.aggregate({
        where: { ...funcionario, ativo: true },
        _sum: { salarioBase: true },
      }),
      // Bônus fixo é salário recorrente na prática: entra na folha base.
      this.prisma.lancamento.aggregate({
        where: {
          tipo: TipoLancamento.BONUS,
          competencia: null,
          ativo: true,
          funcionario: { ...funcionario, ativo: true },
        },
        _sum: { valor: true },
      }),
    ]);
    const salarios = agg._sum.salarioBase ?? new Prisma.Decimal(0);
    const bonusFixoMensal = bonus._sum.valor ?? new Prisma.Decimal(0);
    return {
      total,
      ativos,
      inativos: total - ativos,
      salarioBaseMensal: salarios,
      bonusFixoMensal,
      folhaBaseMensal: salarios.add(bonusFixoMensal),
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
