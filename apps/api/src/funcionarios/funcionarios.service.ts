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
      // O apelido entra na busca porque é por ele que a pessoa é conhecida:
      // procura-se "Dão", não "Adailton Vieira Pereira". Mesma régua da
      // fantasia do diarista.
      where.OR = [
        { nome: { contains: q.busca, mode: 'insensitive' } },
        { apelido: { contains: q.busca, mode: 'insensitive' } },
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

    /*
     * O avulso já descontado sai da tela.
     *
     * Um lançamento avulso vale por uma competência só: entra no saldo daquela
     * folha e acabou. Continuar na lista depois disso faz a tela mentir de duas
     * maneiras ao mesmo tempo — parece que ainda vai descontar, e a lista vira
     * um arquivo morto que cresce todo mês e esconde o que está para acontecer.
     *
     * "Já descontado" é ter folha de salário gerada naquela competência: é o
     * que de fato consumiu o lançamento. O fixo (sem competência) nunca sai —
     * ele vale todo mês, por definição.
     */
    const avulsos = func.lancamentos.filter((l) => l.competencia);
    const consumidas =
      avulsos.length === 0
        ? new Set<string>()
        : new Set(
            (
              await this.prisma.contaPagar.findMany({
                where: {
                  funcionarioId: id,
                  tipo: TipoLancamento.SALARIO,
                  competencia: {
                    in: [...new Set(avulsos.map((l) => l.competencia!))],
                  },
                },
                select: { competencia: true },
              })
            )
              .map((c) => c.competencia)
              .filter((c): c is string => !!c),
          );

    return {
      ...func,
      lancamentos: func.lancamentos.filter(
        (l) => !l.competencia || !consumidas.has(l.competencia),
      ),
    };
  }

  async atualizar(id: string, dto: UpdateFuncionarioDto) {
    await this.assertExiste(id);
    return this.prisma.funcionario.update({
      where: { id },
      data: {
        observacoes: dto.observacoes,
        // Vazio limpa: quem não tem apelido não fica com um em branco gravado.
        ...(dto.apelido === undefined
          ? {}
          : { apelido: dto.apelido.trim() || null }),
        chavePix: dto.chavePix,
        // Vazio limpa: volta a valer a dedução pelo formato da chave.
        ...(dto.tipoChavePix !== undefined
          ? { tipoChavePix: dto.tipoChavePix }
          : {}),
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
        ...(dto.valorAReceberFolha !== undefined
          ? {
              valorAReceberFolha: dto.valorAReceberFolha
                ? new Prisma.Decimal(dto.valorAReceberFolha)
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
    const [total, ativos, basesDosAtivos, bonus] = await this.prisma.$transaction([
      this.prisma.funcionario.count({ where: funcionario }),
      this.prisma.funcionario.count({ where: { ...funcionario, ativo: true } }),
      // Quem tem carteira assinada entra pelo "a receber na folha" — é esse o
      // dinheiro que sai por aqui; o salário oficial vai pela contabilidade.
      this.prisma.funcionario.findMany({
        where: { ...funcionario, ativo: true },
        select: {
          salarioBase: true,
          carteiraAssinada: true,
          valorAReceberFolha: true,
        },
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
    const salarios = basesDosAtivos.reduce(
      (soma, f) =>
        soma.add(
          f.carteiraAssinada && f.valorAReceberFolha?.gt(0)
            ? f.valorAReceberFolha
            : f.salarioBase,
        ),
      new Prisma.Decimal(0),
    );
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
