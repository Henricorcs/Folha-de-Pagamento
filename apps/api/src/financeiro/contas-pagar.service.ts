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
  lerStatusAuditoria,
  type StatusAuditoriaIxc,
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
  /** Conta de SALÁRIO que já existe nesta competência (null = ainda não). */
  salarioJaGerado: ContaJaGerada | null;
  lancamentos: LancamentoCalculado[];
}

/** O que a conferência com o IXC descobriu sobre uma conta. */
export interface ResultadoSincronizacao {
  /** null = não existe mais no IXC e foi apagada daqui também. */
  conta: ContaPagar | null;
  removida: boolean;
  /** O IXC mudou a situação da conta (pagou, aprovou, reprovou, cancelou). */
  mudouStatus: boolean;
  statusAnterior: StatusContaPagar;
}

export interface ResumoSincronizacao {
  verificadas: number;
  pagas: number;
  /** Sumiram do IXC e foram apagadas daqui. */
  removidas: number;
  /** Mudaram de situação por causa do IXC (inclui as pagas). */
  atualizadas: number;
  erros: number;
}

/** Por quantos dias uma conta paga continua sendo conferida no IXC. */
const DIAS_CONFERE_PAGA = 90;

/** Quanto esperar antes de tentar de novo a tabela de auditoria do IXC. */
const PAUSA_AUDITORIA_MS = 5 * 60_000;

@Injectable()
export class ContasPagarService {
  private readonly logger = new Logger(ContasPagarService.name);
  /** Até quando parar de consultar a tabela de auditoria (ver `auditoriaNoIxc`). */
  private auditoriaIndisponivelAte = 0;

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
    const contasDia25 = await this.contasPorTipo(
      dto.competencia,
      ids,
      TipoLancamento.ADIANTAMENTO,
    );
    // Salário já gerado nesta competência: gerar de novo paga duas vezes.
    const contasSalario = await this.contasPorTipo(
      dto.competencia,
      ids,
      TipoLancamento.SALARIO,
    );
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
        // Carteira assinada: a folha daqui trabalha em cima do combinado.
        valorAReceberFolha:
          f.valorAReceberFolha === null ? null : Number(f.valorAReceberFolha),
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
        salarioJaGerado: montarContaJaGerada(contasSalario.get(f.id) ?? null),
        lancamentos,
      };
    });
  }

  /** Conta a pagar daquele tipo, por funcionário, na competência. */
  private async contasPorTipo(
    competencia: string,
    funcionarioIds: string[],
    tipo: TipoLancamento,
  ): Promise<Map<string, ContaAdiantamento>> {
    if (funcionarioIds.length === 0) return new Map();
    const contas = await this.prisma.contaPagar.findMany({
      where: {
        competencia,
        tipo,
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

  /**
   * Fecha as parcelas de vale que entraram nos salários recém-gerados,
   * guardando qual conta consumiu cada uma. A partir daí a parcela sai do
   * cálculo — gerar a folha de novo não desconta o mesmo vale duas vezes.
   */
  private async baixarParcelasDeVale(contas: ContaPagar[]): Promise<void> {
    for (const c of contas) {
      if (c.tipo !== TipoLancamento.SALARIO) continue;
      if (!c.funcionarioId || !c.competencia) continue;
      await this.vales.baixarNaFolha(c.id, c.competencia, c.funcionarioId);
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

  /**
   * Aprova ou reprova no IXC e reflete aqui. Dá para mudar de ideia nos dois
   * sentidos — reprovada volta a ser aprovada e vice-versa — porque a
   * auditoria do IXC também aceita: só o pagamento confirmado pelo banco é
   * ponto final.
   */
  private async auditar(
    id: string,
    status: 'A' | 'R',
    motivo: string,
    usuarioId?: string,
  ): Promise<ContaPagar> {
    const conta = await this.buscar(id);
    if (!conta.idFnApagarIxc) {
      throw new BadRequestException(
        'Conta ainda não existe no IXC — reenvie antes de aprovar ou reprovar',
      );
    }
    if (conta.status === StatusContaPagar.PAGO) {
      throw new BadRequestException(
        'Conta já paga: o banco confirmou. Estorne o pagamento no IXC antes de auditar de novo.',
      );
    }

    await this.ixc.action(
      'fn_apagar_auditoria',
      buildAuditoriaPayload({
        idFnApagar: conta.idFnApagarIxc,
        status,
        motivo,
      }),
    );

    const atualizada = await this.prisma.contaPagar.update({
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

    // Reprovada não vira dinheiro: o vale volta a dever. Aprovada de novo:
    // a parcela é abatida outra vez.
    await this.acertarValesPorStatus(atualizada);
    return atualizada;
  }

  /**
   * Mantém as parcelas de vale coerentes com o destino da conta: o que não vai
   * virar pagamento devolve a parcela para pendente; o que voltou a valer
   * desconta de novo. Sem isso o vale ficaria quitado sem ninguém ter pago —
   * ou seria descontado duas vezes.
   */
  private async acertarValesPorStatus(conta: ContaPagar): Promise<void> {
    const naoVaiAcontecer =
      conta.status === StatusContaPagar.REPROVADO ||
      conta.status === StatusContaPagar.CANCELADO;

    if (naoVaiAcontecer) {
      await this.vales.estornarBaixa(conta.id);
      return;
    }
    if (conta.tipo !== TipoLancamento.SALARIO) return;
    if (!conta.competencia || !conta.funcionarioId) return;
    await this.vales.baixarNaFolha(
      conta.id,
      conta.competencia,
      conta.funcionarioId,
    );
  }

  // -------------------------------------------------------------------------
  // 4) Monitorar no IXC: pagamento, auditoria feita por lá e exclusão
  // -------------------------------------------------------------------------
  /**
   * Traz do IXC o que aconteceu com a conta: se o banco pagou, se alguém
   * aprovou/reprovou/cancelou por lá — e, quando o registro não existe mais,
   * apaga aqui também. O IXC é a fonte da verdade; as duas telas precisam
   * contar a mesma história.
   */
  async sincronizarStatus(id: string): Promise<ResultadoSincronizacao> {
    const conta = await this.buscar(id);
    const statusAnterior = conta.status;
    if (!conta.idFnApagarIxc) {
      return { conta, removida: false, mudouStatus: false, statusAnterior };
    }

    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      conta.idFnApagarIxc,
    );

    // Apagada no IXC: some daqui também.
    if (!raw) {
      await this.apagarLocal(conta.id);
      this.logger.log(
        `Conta ${id} removida daqui: o fn_apagar ${conta.idFnApagarIxc} não existe mais no IXC`,
      );
      return { conta: null, removida: true, mudouStatus: false, statusAnterior };
    }

    const sit = lerSituacaoContaPagar(raw);
    // A auditoria pode não vir no próprio fn_apagar; aí quem sabe é a tabela
    // de auditoria — uma consulta a mais, que só vale a pena quando pagamento
    // e cancelamento ainda não decidiram o assunto sozinhos.
    const auditoria =
      sit.pago || sit.cancelada
        ? null
        : (sit.statusAuditoria ??
          (await this.auditoriaNoIxc(conta.idFnApagarIxc)));

    const novo = statusPeloIxc(conta.status, {
      pago: sit.pago,
      cancelada: sit.cancelada,
      auditoria,
    });

    const data: Prisma.ContaPagarUpdateInput = {
      ixcStatusRaw: raw as Prisma.InputJsonValue,
    };
    if (novo) {
      data.status = novo;
      if (novo === StatusContaPagar.PAGO) {
        data.pagoEm = sit.dataPagamento ?? new Date();
      }
    }

    const atualizada = await this.prisma.contaPagar.update({
      where: { id },
      data,
    });
    if (novo) await this.acertarValesPorStatus(atualizada);

    return {
      conta: atualizada,
      removida: false,
      mudouStatus: novo !== null,
      statusAnterior,
    };
  }

  /**
   * Último registro de auditoria daquele fn_apagar. É o que permite enxergar
   * aqui a aprovação/reprovação feita na tela do IXC. Se a consulta falhar
   * (nome de campo diferente nesta base), devolve null em vez de derrubar a
   * verificação inteira.
   */
  private async auditoriaNoIxc(
    idFnApagar: number,
  ): Promise<StatusAuditoriaIxc | null> {
    // Depois de uma falha, dá um tempo: numa verificação em lote não adianta
    // repetir a mesma consulta quebrada conta a conta.
    if (Date.now() < this.auditoriaIndisponivelAte) return null;
    try {
      const res = await this.ixc.list<Record<string, unknown>>(
        'fn_apagar_auditoria',
        {
          qtype: 'fn_apagar_auditoria.id_fn_apagar',
          query: String(idFnApagar),
          oper: '=',
          sortname: 'fn_apagar_auditoria.id',
          sortorder: 'desc',
          rp: 1,
        },
      );
      const ultimo = res.registros[0];
      return ultimo ? lerStatusAuditoria(ultimo) : null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.auditoriaIndisponivelAte = Date.now() + PAUSA_AUDITORIA_MS;
      this.logger.warn(
        `Não foi possível ler a auditoria do fn_apagar ${idFnApagar}: ${message}`,
      );
      return null;
    }
  }

  /**
   * Confere no IXC todas as contas que ainda podem mudar de lá para cá (para
   * um job/polling). Entram as que não estão pagas — inclusive reprovadas, que
   * podem ter sido liberadas ou apagadas por lá — e as pagas recentes, para
   * pegar exclusão e estorno enquanto o mês ainda está fresco.
   */
  async sincronizarPendentes(): Promise<ResumoSincronizacao> {
    const contas = await this.prisma.contaPagar.findMany({
      where: {
        idFnApagarIxc: { not: null },
        OR: [
          { status: { not: StatusContaPagar.PAGO } },
          {
            status: StatusContaPagar.PAGO,
            updatedAt: { gte: diasAtras(DIAS_CONFERE_PAGA) },
          },
        ],
      },
      select: { id: true },
    });

    let pagas = 0;
    let removidas = 0;
    let atualizadas = 0;
    let erros = 0;
    for (const p of contas) {
      try {
        const r = await this.sincronizarStatus(p.id);
        if (r.removida) removidas++;
        else if (r.mudouStatus) {
          atualizadas++;
          if (r.conta?.status === StatusContaPagar.PAGO) pagas++;
        }
      } catch (err) {
        // Uma conta com falha não deve abortar a verificação das demais.
        erros++;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha ao sincronizar conta ${p.id}: ${message}`);
      }
    }
    return { verificadas: contas.length, pagas, removidas, atualizadas, erros };
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

  /**
   * Apaga a conta dos dois lados: primeiro o fn_apagar no IXC, depois o
   * registro daqui. Se o IXC recusar, nada é apagado — as duas telas não podem
   * divergir. Conta já paga fica de fora: dinheiro que saiu é histórico, e o
   * caminho é estornar no IXC (a verificação traz a mudança para cá).
   */
  async remover(id: string): Promise<void> {
    const conta = await this.buscar(id);
    if (conta.status === StatusContaPagar.PAGO) {
      throw new BadRequestException(
        'Esta conta já foi paga — estorne ou apague no IXC e clique em ' +
          '"Verificar" para ela sair daqui.',
      );
    }
    if (conta.idFnApagarIxc) await this.apagarNoIxc(conta.idFnApagarIxc);
    await this.apagarLocal(id);
  }

  /** Apaga o fn_apagar no IXC. Já não existir por lá não é erro. */
  private async apagarNoIxc(idFnApagar: number): Promise<void> {
    try {
      await this.ixc.remove('fn_apagar', idFnApagar);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (await this.existeNoIxc(idFnApagar)) {
        throw new BadRequestException(
          `O IXC não apagou a conta (fn_apagar ${idFnApagar}): ${message}`,
        );
      }
      this.logger.warn(
        `fn_apagar ${idFnApagar} já não existia no IXC ao apagar: ${message}`,
      );
    }
  }

  /** Na dúvida (consulta falhou), assume que existe e não apaga nada aqui. */
  private async existeNoIxc(idFnApagar: number): Promise<boolean> {
    try {
      const raw = await this.ixc.getById('fn_apagar', 'fn_apagar.id', idFnApagar);
      return raw !== null;
    } catch {
      return true;
    }
  }

  /** Apaga só o registro local, soltando o que dependia dele. */
  private async apagarLocal(id: string): Promise<void> {
    // Antes de apagar: a FK vira null e a parcela ficaria baixada sem dono.
    await this.vales.estornarBaixa(id);
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

/** Aviso de que aquele pagamento já existe na competência. */
export interface ContaJaGerada {
  situacao: 'PAGO' | 'PENDENTE';
  status: StatusContaPagar;
  pagoEm: Date | null;
}

/**
 * Conta que ainda vale como "já gerada". Cancelada ou reprovada não conta —
 * não vai virar pagamento, então gerar de novo é o certo.
 */
export function montarContaJaGerada(
  conta: ContaAdiantamento | null,
): ContaJaGerada | null {
  if (!conta) return null;
  if (
    conta.status === StatusContaPagar.CANCELADO ||
    conta.status === StatusContaPagar.REPROVADO
  ) {
    return null;
  }
  return {
    situacao: conta.pago ? 'PAGO' : 'PENDENTE',
    status: conta.status,
    pagoEm: conta.pagoEm,
  };
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

/** Como o IXC vê a conta agora. */
export interface SituacaoNoIxc {
  pago: boolean;
  cancelada: boolean;
  auditoria: StatusAuditoriaIxc | null;
}

/**
 * Para qual situação a conta daqui deve ir depois do que o IXC respondeu.
 * null = nada muda.
 *
 * O pagamento confirmado vence tudo. Depois vale a auditoria feita lá: quem
 * reprova, cancela ou libera na tela do IXC manda no que aparece aqui. Sem
 * notícia nenhuma da auditoria, o status local é preservado — pode ser que a
 * base nem exponha esse dado, e chute nenhum é melhor que chute errado.
 */
export function statusPeloIxc(
  atual: StatusContaPagar,
  ixc: SituacaoNoIxc,
): StatusContaPagar | null {
  const mudarPara = (destino: StatusContaPagar) =>
    destino === atual ? null : destino;

  if (ixc.pago) return mudarPara(StatusContaPagar.PAGO);
  if (ixc.cancelada) return mudarPara(StatusContaPagar.CANCELADO);

  switch (ixc.auditoria) {
    case 'R':
      return mudarPara(StatusContaPagar.REPROVADO);
    case 'C':
      return mudarPara(StatusContaPagar.CANCELADO);
    case 'A':
      // Liberada pela auditoria: falta o "pagar com ModoBank".
      return atual === StatusContaPagar.PAGO
        ? null
        : mudarPara(StatusContaPagar.AGUARDANDO_PAGAMENTO);
    default:
      return null;
  }
}

function hojeUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
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
