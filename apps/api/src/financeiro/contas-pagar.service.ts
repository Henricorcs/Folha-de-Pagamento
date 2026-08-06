import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ContaPagar,
  Prisma,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import { IxcClient } from '../ixc/ixc.client';
import {
  buildAuditoriaPayload,
  buildContaPagarPayload,
  lerSituacaoContaPagar,
} from '../ixc/ixc.financeiro';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigFinanceiraService } from './config-financeira.service';
import { FornecedorService } from './fornecedor.service';
import {
  ValesService,
  type AcertoValeCompetencia,
} from '../vales/vales.service';
import {
  calcularAdiantamento,
  competenciaAnterior,
  detalharSalario,
  montarLancamentosFolha,
  renderObs,
  type ComposicaoSalario,
  type DadosFolhaFuncionario,
  type LancamentoCalculado,
} from './folha.calc';
import { CriarContasPagarDto, ItemContaPagarDto } from './dto/criar-contas.dto';
import { PrepararFolhaDto } from './dto/preparar-folha.dto';
import { QueryContasPagarDto } from './dto/query-contas.dto';

/** Situação do adiantamento do dia 25 na competência da prévia. */
export interface SituacaoAdiantamento {
  /** Valor apurado para o dia 25 (cadastro, lançamento ou percentual). */
  valor: number;
  /** Foi abatido do saldo salarial desta prévia? */
  descontado: boolean;
  /** PAGO = retorno do banco; PENDENTE = gerado, ainda não pago. */
  situacao: 'PAGO' | 'PENDENTE' | 'NAO_GERADO';
  /** Status cru da conta a pagar do dia 25, quando existe. */
  status: StatusContaPagar | null;
  pagoEm: Date | null;
}

export interface PreviewFuncionario {
  funcionarioId: string;
  nome: string;
  carteiraAssinada: boolean;
  recebeAdiantamento: boolean;
  /** null para quem não recebe adiantamento no dia 25. */
  adiantamento: SituacaoAdiantamento | null;
  /** Como o saldo salarial foi montado (proventos e descontos do mês). */
  composicao: ComposicaoSalario;
  /** Parcelas de vale/acerto que mexeram nesta competência. */
  vales: AcertoValeCompetencia['parcelas'];
  lancamentos: LancamentoCalculado[];
}

@Injectable()
export class ContasPagarService {
  private readonly logger = new Logger(ContasPagarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly config: ConfigFinanceiraService,
    private readonly fornecedores: FornecedorService,
    private readonly vales: ValesService,
  ) {}

  // -------------------------------------------------------------------------
  // 1) Preview: calcula os lançamentos sugeridos (não persiste nada)
  // -------------------------------------------------------------------------
  async prepararFolha(dto: PrepararFolhaDto): Promise<PreviewFuncionario[]> {
    const cfg = await this.config.obter();
    // Só entra na folha quem o filtro do IXC marcou como funcionário
    // (fornecedor ativo + ICMS isento). Ver [[project]].
    const where: Prisma.FuncionarioWhereInput = { ativo: true, isentoIcms: true };
    if (dto.funcionarioIds?.length) where.id = { in: dto.funcionarioIds };

    // Salário e bônus se referem ao mês trabalhado (o anterior); só o
    // adiantamento do dia 25 fala do mês corrente. Vendas e horas extras são
    // do mês trabalhado; a parcela do vale é do mês em que se paga.
    const mesTrabalhado = competenciaAnterior(dto.competencia);

    const funcionarios = await this.prisma.funcionario.findMany({
      where,
      include: {
        // Fixos (sem competência) + avulsos desta competência
        lancamentos: {
          where: {
            ativo: true,
            OR: [{ competencia: null }, { competencia: dto.competencia }],
          },
        },
        variaveisMes: { where: { competencia: mesTrabalhado } },
      },
      orderBy: { nome: 'asc' },
    });

    const params = {
      contaContabilSalario: cfg.contaContabilSalario,
      contaContabilAdiantamento: cfg.contaContabilAdiantamento,
      contaContabilBonus: cfg.contaContabilBonus,
      obsSalario: renderObs(cfg.obsSalarioTemplate, mesTrabalhado),
      obsAdiantamento: renderObs(cfg.obsAdiantamentoTemplate, dto.competencia),
      obsBonus: renderObs(cfg.obsBonusTemplate, mesTrabalhado),
      percentualAdiantamento: cfg.percentualAdiantamento,
    };

    // Situação do adiantamento do dia 25 desta competência, para mostrar na
    // folha do quinto dia se o valor descontado do salário já foi mesmo pago.
    const ids = funcionarios.map((f) => f.id);
    const contasDia25 = await this.contasDoAdiantamento(dto.competencia, ids);
    // Vales e acertos só mexem no salário; no dia 25 não há o que abater.
    const acertosVale: Map<string, AcertoValeCompetencia> =
      (dto.incluirSalario ?? true)
        ? await this.vales.acertosDaCompetencia(dto.competencia, ids)
        : new Map();

    return funcionarios.map((f) => {
      const somaTipo = (tipo: TipoLancamento) =>
        f.lancamentos
          .filter((l) => l.tipo === tipo)
          .reduce((s, l) => s + Number(l.valor), 0);

      const variaveis = f.variaveisMes[0];
      const vale = acertosVale.get(f.id);

      const dados: DadosFolhaFuncionario = {
        salarioBase: Number(f.salarioBase),
        carteiraAssinada: f.carteiraAssinada,
        recebeAdiantamento: f.recebeAdiantamento,
        valorAdiantamento:
          f.valorAdiantamento === null ? null : Number(f.valorAdiantamento),
        adiantamentoFixo: somaTipo(TipoLancamento.ADIANTAMENTO),
        descontosFixos: somaTipo(TipoLancamento.DESCONTO),
        bonusFixo: somaTipo(TipoLancamento.BONUS),
        vendas: variaveis?.vendas ?? 0,
        // O valor por venda do mês vence o do cadastro (ex.: campanha).
        valorPorVenda: Number(
          variaveis?.valorPorVenda ?? f.valorPorVenda ?? 0,
        ),
        horasExtras: Number(variaveis?.horasExtras ?? 0),
        descontoVales: vale?.desconto ?? 0,
        creditoVales: vale?.credito ?? 0,
      };

      const lancamentos = montarLancamentosFolha(dados, params, {
        incluirAdiantamento: dto.incluirAdiantamento ?? true,
        incluirSalario: dto.incluirSalario ?? true,
        incluirBonus: dto.incluirBonus ?? true,
      });

      const valorAdiantamento = calcularAdiantamento(
        dados,
        cfg.percentualAdiantamento,
      );

      return {
        funcionarioId: f.id,
        nome: f.nome,
        carteiraAssinada: f.carteiraAssinada,
        recebeAdiantamento: f.recebeAdiantamento,
        adiantamento:
          valorAdiantamento > 0
            ? montarSituacaoAdiantamento(
                valorAdiantamento,
                // O desconto no saldo só acontece para quem não tem carteira.
                !f.carteiraAssinada,
                contasDia25.get(f.id) ?? null,
              )
            : null,
        composicao: detalharSalario(dados, cfg.percentualAdiantamento),
        vales: vale?.parcelas ?? [],
        lancamentos,
      };
    });
  }

  /** Conta a pagar de ADIANTAMENTO de cada funcionário na competência. */
  private async contasDoAdiantamento(
    competencia: string,
    funcionarioIds: string[],
  ): Promise<Map<string, ContaAdiantamento>> {
    if (funcionarioIds.length === 0) return new Map();
    const contas = await this.prisma.contaPagar.findMany({
      where: {
        competencia,
        tipo: TipoLancamento.ADIANTAMENTO,
        funcionarioId: { in: funcionarioIds },
      },
      select: { funcionarioId: true, status: true, pagoEm: true },
      orderBy: { createdAt: 'desc' },
    });

    const mapa = new Map<string, ContaAdiantamento>();
    for (const c of contas) {
      if (!c.funcionarioId) continue;
      // Se houver mais de uma, a paga vence; senão fica a mais recente.
      const atual = mapa.get(c.funcionarioId);
      if (!atual || (c.status === StatusContaPagar.PAGO && !atual.pago)) {
        mapa.set(c.funcionarioId, {
          status: c.status,
          pago: c.status === StatusContaPagar.PAGO,
          pagoEm: c.pagoEm,
        });
      }
    }
    return mapa;
  }

  // -------------------------------------------------------------------------
  // 2) Criar: persiste localmente e envia ao IXC (fn_apagar)
  // -------------------------------------------------------------------------
  async criar(
    dto: CriarContasPagarDto,
    usuarioId?: string,
  ): Promise<ContaPagar[]> {
    const criadas: ContaPagar[] = [];
    for (const item of dto.itens) {
      const conta = await this.criarItem(item, usuarioId);
      criadas.push(conta);
    }
    // O salário do mês saiu com a parcela do vale já abatida: dá baixa nela.
    await this.baixarParcelasDeVale(criadas);
    return criadas;
  }

  /** Fecha as parcelas de vale que entraram nos salários recém-gerados. */
  private async baixarParcelasDeVale(contas: ContaPagar[]): Promise<void> {
    const porCompetencia = new Map<string, string[]>();
    for (const c of contas) {
      if (c.tipo !== TipoLancamento.SALARIO) continue;
      if (!c.funcionarioId || !c.competencia) continue;
      const ids = porCompetencia.get(c.competencia) ?? [];
      ids.push(c.funcionarioId);
      porCompetencia.set(c.competencia, ids);
    }
    for (const [competencia, ids] of porCompetencia) {
      await this.vales.marcarDescontadas(competencia, ids);
    }
  }

  private async criarItem(
    item: ItemContaPagarDto,
    usuarioId?: string,
  ): Promise<ContaPagar> {
    if (!item.funcionarioId && !item.beneficiarioAvulsoId) {
      throw new BadRequestException(
        'Informe funcionarioId ou beneficiarioAvulsoId',
      );
    }
    const cfg = await this.config.obter();
    const hoje = hojeUtc();

    const contaContabil =
      item.contaContabil ?? contaContabilPorTipo(item.tipo, cfg);
    const observacao =
      item.observacao ?? obsPorTipo(item.tipo, item.competencia ?? null, cfg);

    const beneficiarioNome = await this.resolverNome(item);

    // Persiste como RASCUNHO
    const conta = await this.prisma.contaPagar.create({
      data: {
        competencia: item.competencia ?? null,
        tipo: item.tipo,
        funcionarioId: item.funcionarioId ?? null,
        beneficiarioAvulsoId: item.beneficiarioAvulsoId ?? null,
        beneficiarioNome,
        valor: new Prisma.Decimal(item.valor),
        contaContabil,
        contaPagamento: cfg.contaPagamentoId,
        filialId: cfg.filialId,
        dataEmissao: hoje,
        dataVencimento: hoje,
        observacao,
        status: StatusContaPagar.RASCUNHO,
        criadoPor: usuarioId ?? null,
      },
    });

    return this.enviarIxc(conta.id);
  }

  /** Garante fornecedor e cria o fn_apagar no IXC. */
  async enviarIxc(id: string): Promise<ContaPagar> {
    const conta = await this.buscar(id);
    if (
      conta.status !== StatusContaPagar.RASCUNHO &&
      conta.status !== StatusContaPagar.ERRO
    ) {
      throw new BadRequestException(
        `Conta já enviada ao IXC (status ${conta.status})`,
      );
    }

    try {
      const idFornecedor = conta.funcionarioId
        ? await this.fornecedores.garantirParaFuncionario(conta.funcionarioId)
        : await this.fornecedores.garantirParaAvulso(conta.beneficiarioAvulsoId!);

      const cfg = await this.config.obter();
      const chavePix = await this.chavePixDoBeneficiario(conta);

      const payload = buildContaPagarPayload({
        idFornecedor,
        valor: Number(conta.valor),
        contaPagamentoId: conta.contaPagamento,
        contaContabilId: conta.contaContabil,
        filialId: conta.filialId,
        dataEmissao: conta.dataEmissao,
        dataVencimento: conta.dataVencimento,
        observacao: conta.observacao,
        tipoPagamento: cfg.tipoPagamentoPadrao,
        chavePix,
      });

      const { id: idFnApagar } = await this.ixc.create('fn_apagar', payload);
      if (!idFnApagar) throw new Error('IXC não retornou o id do fn_apagar');

      return this.prisma.contaPagar.update({
        where: { id },
        data: {
          idFornecedorIxc: idFornecedor,
          idFnApagarIxc: idFnApagar,
          status: StatusContaPagar.AGUARDANDO_APROVACAO,
          erro: null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enviar conta ${id} ao IXC: ${message}`);
      return this.prisma.contaPagar.update({
        where: { id },
        data: { status: StatusContaPagar.ERRO, erro: message },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3) Auditoria: aprovar / reprovar (fn_apagar_auditoria)
  // -------------------------------------------------------------------------
  async aprovar(id: string, motivo: string, usuarioId?: string) {
    return this.auditar(id, 'A', motivo, usuarioId);
  }

  async reprovar(id: string, motivo: string, usuarioId?: string) {
    return this.auditar(id, 'R', motivo, usuarioId);
  }

  private async auditar(
    id: string,
    status: 'A' | 'R',
    motivo: string,
    usuarioId?: string,
  ): Promise<ContaPagar> {
    const conta = await this.buscar(id);
    if (conta.status !== StatusContaPagar.AGUARDANDO_APROVACAO) {
      throw new BadRequestException(
        `Conta não está aguardando aprovação (status ${conta.status})`,
      );
    }
    if (!conta.idFnApagarIxc) {
      throw new BadRequestException('Conta sem vínculo no IXC (idFnApagar)');
    }

    await this.ixc.action(
      'fn_apagar_auditoria',
      buildAuditoriaPayload({
        idFnApagar: conta.idFnApagarIxc,
        status,
        motivo,
      }),
    );

    return this.prisma.contaPagar.update({
      where: { id },
      data: {
        status:
          status === 'A'
            ? StatusContaPagar.AGUARDANDO_PAGAMENTO
            : StatusContaPagar.REPROVADO,
        aprovadoPor: usuarioId ?? null,
        aprovadoEm: new Date(),
        motivoAuditoria: motivo,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 4) Monitorar pagamento: lê o fn_apagar no IXC e detecta "pago"
  // -------------------------------------------------------------------------
  async sincronizarStatus(id: string): Promise<ContaPagar> {
    const conta = await this.buscar(id);
    if (!conta.idFnApagarIxc) return conta;

    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      conta.idFnApagarIxc,
    );
    if (!raw) return conta;

    const sit = lerSituacaoContaPagar(raw);
    const data: Prisma.ContaPagarUpdateInput = {
      ixcStatusRaw: raw as Prisma.InputJsonValue,
    };
    if (sit.pago && conta.status !== StatusContaPagar.PAGO) {
      data.status = StatusContaPagar.PAGO;
      data.pagoEm = sit.dataPagamento ?? new Date();
    }
    return this.prisma.contaPagar.update({ where: { id }, data });
  }

  /** Verifica todas as contas aguardando pagamento (para um job/polling). */
  async sincronizarPendentes(): Promise<{
    verificadas: number;
    pagas: number;
    erros: number;
  }> {
    const pendentes = await this.prisma.contaPagar.findMany({
      where: {
        status: {
          in: [
            StatusContaPagar.AGUARDANDO_PAGAMENTO,
            StatusContaPagar.AGUARDANDO_APROVACAO,
          ],
        },
        idFnApagarIxc: { not: null },
      },
      select: { id: true },
    });
    let pagas = 0;
    let erros = 0;
    for (const p of pendentes) {
      try {
        const atual = await this.sincronizarStatus(p.id);
        if (atual.status === StatusContaPagar.PAGO) pagas++;
      } catch (err) {
        // Uma conta com falha não deve abortar a verificação das demais.
        erros++;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha ao sincronizar conta ${p.id}: ${message}`);
      }
    }
    return { verificadas: pendentes.length, pagas, erros };
  }

  // -------------------------------------------------------------------------
  // Consultas / manutenção
  // -------------------------------------------------------------------------
  async listar(q: QueryContasPagarDto) {
    const where: Prisma.ContaPagarWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.competencia) where.competencia = q.competencia;
    if (q.funcionarioId) where.funcionarioId = q.funcionarioId;
    if (q.tipo) where.tipo = q.tipo;

    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;

    const [total, itens] = await this.prisma.$transaction([
      this.prisma.contaPagar.count({ where }),
      this.prisma.contaPagar.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      itens,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async buscar(id: string): Promise<ContaPagar> {
    const conta = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!conta) throw new NotFoundException('Conta a pagar não encontrada');
    return conta;
  }

  async remover(id: string): Promise<void> {
    const conta = await this.buscar(id);
    if (
      conta.status !== StatusContaPagar.RASCUNHO &&
      conta.status !== StatusContaPagar.ERRO
    ) {
      throw new BadRequestException(
        'Só é possível remover contas em rascunho ou com erro',
      );
    }
    await this.prisma.contaPagar.delete({ where: { id } });
  }

  /** Chave PIX do funcionário (sincronizada do IXC) ou do beneficiário avulso. */
  private async chavePixDoBeneficiario(conta: {
    funcionarioId: string | null;
    beneficiarioAvulsoId: string | null;
  }): Promise<string | null> {
    if (conta.funcionarioId) {
      const f = await this.prisma.funcionario.findUnique({
        where: { id: conta.funcionarioId },
        select: { chavePix: true },
      });
      return f?.chavePix ?? null;
    }
    if (conta.beneficiarioAvulsoId) {
      const b = await this.prisma.beneficiarioAvulso.findUnique({
        where: { id: conta.beneficiarioAvulsoId },
        select: { chavePix: true },
      });
      return b?.chavePix ?? null;
    }
    return null;
  }

  private async resolverNome(item: ItemContaPagarDto): Promise<string> {
    if (item.funcionarioId) {
      const f = await this.prisma.funcionario.findUnique({
        where: { id: item.funcionarioId },
        select: { nome: true },
      });
      if (!f) throw new NotFoundException('Funcionário não encontrado');
      return f.nome;
    }
    const b = await this.prisma.beneficiarioAvulso.findUnique({
      where: { id: item.beneficiarioAvulsoId! },
      select: { nome: true },
    });
    if (!b) throw new NotFoundException('Beneficiário não encontrado');
    return b.nome;
  }
}

/** Conta a pagar do dia 25 encontrada para um funcionário. */
export interface ContaAdiantamento {
  status: StatusContaPagar;
  pago: boolean;
  pagoEm: Date | null;
}

/**
 * Traduz a conta do dia 25 em algo acionável na folha do quinto dia: se o
 * adiantamento que está sendo abatido do salário já caiu na conta da pessoa.
 * Conta cancelada conta como não gerada — não há o que descontar.
 */
export function montarSituacaoAdiantamento(
  valor: number,
  descontado: boolean,
  conta: ContaAdiantamento | null,
): SituacaoAdiantamento {
  const cancelada = conta?.status === StatusContaPagar.CANCELADO;
  const situacao = !conta || cancelada
    ? 'NAO_GERADO'
    : conta.pago
      ? 'PAGO'
      : 'PENDENTE';

  return {
    valor,
    descontado,
    situacao,
    status: conta?.status ?? null,
    pagoEm: conta?.pagoEm ?? null,
  };
}

function hojeUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function contaContabilPorTipo(
  tipo: TipoLancamento,
  cfg: { contaContabilSalario: number; contaContabilAdiantamento: number; contaContabilBonus: number },
): number {
  switch (tipo) {
    case TipoLancamento.ADIANTAMENTO:
      return cfg.contaContabilAdiantamento;
    case TipoLancamento.BONUS:
      return cfg.contaContabilBonus;
    default:
      return cfg.contaContabilSalario;
  }
}

function obsPorTipo(
  tipo: TipoLancamento,
  competencia: string | null,
  cfg: {
    obsSalarioTemplate: string;
    obsAdiantamentoTemplate: string;
    obsBonusTemplate: string;
  },
): string {
  const comp = competencia ?? '';
  // Adiantamento é do mês corrente; salário e bônus, do mês trabalhado.
  switch (tipo) {
    case TipoLancamento.ADIANTAMENTO:
      return renderObs(cfg.obsAdiantamentoTemplate, comp);
    case TipoLancamento.BONUS:
      return renderObs(cfg.obsBonusTemplate, competenciaAnterior(comp));
    default:
      return renderObs(cfg.obsSalarioTemplate, competenciaAnterior(comp));
  }
}
