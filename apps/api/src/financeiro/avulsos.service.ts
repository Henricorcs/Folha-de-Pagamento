import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BeneficiarioAvulso,
  FormaPagamento,
  PagamentoAvulso,
  Prisma,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import { CaixaService } from '../ixc/caixa.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigFinanceiraService } from './config-financeira.service';
import { ContasPagarService } from './contas-pagar.service';
import {
  CriarBeneficiarioDto,
  PagarAvulsoDto,
  UpdateBeneficiarioDto,
} from './dto/avulso.dto';
import { FornecedorService, type FornecedorNoIxc } from './fornecedor.service';
import {
  calcularComissaoVendas,
  calcularTotalPagamento,
  montarHistoricoCaixa,
  montarObservacaoPagamento,
  type PartesDoPagamento,
} from './pagamento.calc';

/** Beneficiário com o que a listagem mostra sem abrir o cadastro. */
export interface BeneficiarioComResumo {
  beneficiario: BeneficiarioAvulso;
  quantidadePagamentos: number;
  /** Só o dinheiro que de fato saiu: em mãos, ou conta a pagar já PAGA. */
  totalPago: number;
  quantidadePagas: number;
  /** Lançado no IXC e ainda a caminho do banco. */
  totalAguardando: number;
  quantidadeAguardando: number;
  /** Contas que o IXC recusou — não saíram e precisam de correção. */
  quantidadeComErro: number;
  ultimoPagamento: Date | null;
  /** Pagos em mãos que ainda não viraram lançamento no caixa do IXC. */
  pendentesNoCaixa: number;
}

/** Cadastro salvo, mais o que não deu certo do lado do IXC (se algo). */
export interface BeneficiarioSalvo {
  beneficiario: BeneficiarioAvulso;
  /** null = correu tudo bem. */
  avisoIxc: string | null;
}

/** O que a tela precisa saber antes de cadastrar alguém com aquele documento. */
export interface ConsultaCpfCnpj {
  /** Já cadastrado aqui (a busca é local, e vence a do IXC). */
  beneficiario: BeneficiarioAvulso | null;
  /** Já existe como fornecedor no IXC. */
  fornecedor: FornecedorNoIxc | null;
  /** Não deu para perguntar ao IXC agora — o cadastro não precisa parar. */
  ixcIndisponivel: string | null;
}

/**
 * Pagamentos avulsos: quem recebe da empresa sem estar na folha e sem ser
 * diarista — mão de obra contratada, serviço pontual, patrocínio.
 *
 * O caminho do dinheiro é o mesmo da diária, e de propósito: conta a pagar no
 * IXC (fornecedor, auditoria, banco) ou dinheiro em mãos saindo do caixa
 * configurado. O que muda é só a conta contábil.
 */
@Injectable()
export class AvulsosService {
  private readonly logger = new Logger(AvulsosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigFinanceiraService,
    private readonly contasPagar: ContasPagarService,
    private readonly fornecedores: FornecedorService,
    private readonly caixa: CaixaService,
  ) {}

  // -------------------------------------------------------------------------
  // Cadastro
  // -------------------------------------------------------------------------
  async listarBeneficiarios(
    busca?: string,
    todos = false,
  ): Promise<BeneficiarioComResumo[]> {
    const where: Prisma.BeneficiarioAvulsoWhereInput = {};
    if (!todos) where.ativo = true;
    if (busca) {
      where.OR = [
        { nome: { contains: busca, mode: 'insensitive' } },
        { cpfCnpj: { contains: busca, mode: 'insensitive' } },
      ];
    }

    const lista = await this.prisma.beneficiarioAvulso.findMany({
      where,
      orderBy: { nome: 'asc' },
      include: {
        pagamentos: {
          select: {
            valor: true,
            data: true,
            forma: true,
            idLancamentoIxc: true,
            lancadoManual: true,
            contaPagar: { select: { status: true } },
          },
        },
      },
    });

    return lista.map(({ pagamentos, ...beneficiario }) => {
      const pagos = pagamentos.filter(saiu);
      const aguardando = pagamentos.filter(aCaminho);

      return {
        beneficiario,
        quantidadePagamentos: pagamentos.length,
        totalPago: somar(pagos),
        quantidadePagas: pagos.length,
        totalAguardando: somar(aguardando),
        quantidadeAguardando: aguardando.length,
        quantidadeComErro: pagamentos.filter(
          (p) => p.contaPagar?.status === StatusContaPagar.ERRO,
        ).length,
        ultimoPagamento: pagamentos.reduce<Date | null>(
          (maior, p) => (!maior || p.data > maior ? p.data : maior),
          null,
        ),
        pendentesNoCaixa: pagamentos.filter(pendenteNoCaixa).length,
      };
    });
  }

  async buscar(id: string): Promise<BeneficiarioAvulso> {
    const b = await this.prisma.beneficiarioAvulso.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Beneficiário não encontrado');
    return b;
  }

  /**
   * O que já existe com aquele CPF/CNPJ, aqui e no IXC. A tela pergunta antes
   * de cadastrar; decidir sozinha por reaproveitar seria decidir no lugar de
   * quem sabe se é a mesma pessoa.
   */
  async consultarCpfCnpj(cpfCnpj: string): Promise<ConsultaCpfCnpj> {
    const doc = cpfCnpj.trim();
    const beneficiario = await this.prisma.beneficiarioAvulso.findFirst({
      where: { cpfCnpj: doc },
    });

    let fornecedor: FornecedorNoIxc | null = null;
    let ixcIndisponivel: string | null = null;
    try {
      fornecedor = await this.fornecedores.procurarNoIxcPorCpfCnpj(doc);
    } catch (err) {
      // O IXC fora do ar não pode travar um cadastro: o app avisa e segue.
      ixcIndisponivel = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Consulta de CPF/CNPJ no IXC falhou: ${ixcIndisponivel}`);
    }

    return { beneficiario, fornecedor, ixcIndisponivel };
  }

  async criarBeneficiario(
    dto: CriarBeneficiarioDto,
  ): Promise<BeneficiarioSalvo> {
    const beneficiario = await this.prisma.beneficiarioAvulso.create({
      data: { ...this.dadosDoCadastro(dto), nome: dto.nome.trim() },
    });
    return { beneficiario, avisoIxc: await this.espelharPix(beneficiario) };
  }

  async atualizarBeneficiario(
    id: string,
    dto: UpdateBeneficiarioDto,
  ): Promise<BeneficiarioSalvo> {
    await this.buscar(id);
    const beneficiario = await this.prisma.beneficiarioAvulso.update({
      where: { id },
      data: {
        ...this.dadosDoCadastro(dto),
        ...(dto.ativo === undefined ? {} : { ativo: dto.ativo }),
      },
    });
    return { beneficiario, avisoIxc: await this.espelharPix(beneficiario) };
  }

  /**
   * Sobe a chave PIX para a aba "Dados bancários" do fornecedor no IXC, para o
   * próximo pagamento já sair sem digitar de novo.
   *
   * Só faz sentido quando já se sabe qual é o fornecedor — quem ainda não tem
   * um só ganha o cadastro no primeiro pagamento, e é lá que a chave sobe.
   * Falhar aqui devolve o motivo em vez de estourar: a chave continua valendo
   * daqui, que é de onde a conta a pagar a tira.
   */
  private async espelharPix(b: BeneficiarioAvulso): Promise<string | null> {
    if (!b.idFornecedorIxc || !b.chavePix) return null;
    const motivo = await this.fornecedores.espelharPixNoIxc(
      b.idFornecedorIxc,
      b.chavePix,
      b.tipoChavePix,
    );
    return motivo
      ? `A chave ficou salva aqui, mas não subiu para os dados bancários do fornecedor no IXC: ${motivo}.`
      : null;
  }

  /**
   * Apaga o cadastro. Quem já recebeu não é apagado: o histórico de pagamento
   * tem de continuar existindo, então o caminho é desativar.
   */
  async removerBeneficiario(id: string): Promise<void> {
    const pagamentos = await this.prisma.pagamentoAvulso.count({
      where: { beneficiarioId: id },
    });
    if (pagamentos > 0) {
      throw new BadRequestException(
        `${pagamentos} pagamento(s) já saíram para essa pessoa — desative o cadastro em vez de apagar.`,
      );
    }
    await this.buscar(id);
    await this.prisma.beneficiarioAvulso.delete({ where: { id } });
  }

  private dadosDoCadastro(dto: CriarBeneficiarioDto) {
    return {
      ...(dto.nome === undefined ? {} : { nome: dto.nome.trim() }),
      ...(dto.cpfCnpj === undefined ? {} : { cpfCnpj: dto.cpfCnpj || null }),
      ...(dto.tipoPessoa === undefined ? {} : { tipoPessoa: dto.tipoPessoa }),
      ...(dto.telefone === undefined ? {} : { telefone: dto.telefone || null }),
      ...(dto.email === undefined ? {} : { email: dto.email || null }),
      ...(dto.chavePix === undefined ? {} : { chavePix: dto.chavePix || null }),
      ...(dto.tipoChavePix === undefined
        ? {}
        : { tipoChavePix: dto.tipoChavePix }),
      ...(dto.valorPorVenda === undefined
        ? {}
        : {
            valorPorVenda:
              dto.valorPorVenda == null || dto.valorPorVenda <= 0
                ? null
                : new Prisma.Decimal(dto.valorPorVenda),
          }),
      ...(dto.formaPagamento === undefined
        ? {}
        : { formaPagamento: dto.formaPagamento }),
      ...(dto.observacoes === undefined
        ? {}
        : { observacoes: dto.observacoes || null }),
      ...(dto.cidadeIxc === undefined ? {} : { cidadeIxc: dto.cidadeIxc }),
      ...(dto.idFornecedorIxc === undefined
        ? {}
        : { idFornecedorIxc: dto.idFornecedorIxc }),
      ...(dto.fornecedorNovoNoIxc === undefined
        ? {}
        : { fornecedorNovoNoIxc: dto.fornecedorNovoNoIxc }),
    };
  }

  // -------------------------------------------------------------------------
  // Pagamentos
  // -------------------------------------------------------------------------
  listarPagamentos(beneficiarioId?: string) {
    return this.prisma.pagamentoAvulso.findMany({
      where: beneficiarioId ? { beneficiarioId } : undefined,
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: {
        beneficiario: { select: { nome: true } },
        contaPagar: {
          select: { id: true, status: true, erro: true, idFnApagarIxc: true },
        },
      },
    });
  }

  /**
   * Paga alguém de fora da folha: o serviço contratado, a comissão das vendas
   * que a pessoa fechou e o extra do trabalho por fora, somados num pagamento
   * só. Pelo IXC vira conta a pagar como qualquer beneficiário; em mãos, o
   * dinheiro já saiu da gaveta e o app lança a saída no caixa configurado.
   */
  async pagar(
    beneficiarioId: string,
    dto: PagarAvulsoDto,
    usuarioId?: string,
  ): Promise<PagamentoAvulso> {
    const beneficiario = await this.decorarPix(
      await this.buscar(beneficiarioId),
      dto,
    );
    const forma = dto.forma ?? beneficiario.formaPagamento;
    const cfg = await this.config.obter();

    if (forma === FormaPagamento.IXC && !beneficiario.chavePix) {
      throw new BadRequestException(
        'Sem chave PIX o banco não paga. Informe a chave (ou pague em mãos).',
      );
    }

    const partes: PartesDoPagamento = {
      valorServico: dto.valorServico ?? 0,
      vendas: dto.vendas ?? 0,
      valorPorVenda:
        dto.valorPorVenda ?? Number(beneficiario.valorPorVenda ?? 0),
      valorExtra: dto.valorExtra ?? 0,
      descricaoExtra: dto.descricaoExtra?.trim() || null,
    };
    const valor = calcularTotalPagamento(partes);
    if (valor < 0.01) {
      throw new BadRequestException(
        'O pagamento ficou em zero. Informe o valor do serviço, as vendas e ' +
          'quanto cada uma paga, ou um valor extra.',
      );
    }

    const base = {
      beneficiarioId,
      data: dto.data ? new Date(dto.data) : hojeUtc(),
      valor: new Prisma.Decimal(valor),
      vendas: partes.vendas ?? 0,
      valorPorVenda: partes.valorPorVenda
        ? new Prisma.Decimal(partes.valorPorVenda)
        : null,
      comissaoVendas: new Prisma.Decimal(calcularComissaoVendas(partes)),
      valorExtra: new Prisma.Decimal(partes.valorExtra ?? 0),
      descricaoExtra: partes.descricaoExtra,
      descricao: dto.descricao.trim(),
      contaContabil: dto.contaContabil ?? cfg.contaContabilAvulso,
      forma,
      criadoPor: usuarioId ?? null,
    };

    return forma === FormaPagamento.IXC
      ? this.pagarPeloIxc(base, partes, usuarioId)
      : this.pagarEmMaos(beneficiario, base);
  }

  /**
   * A chave PIX corrigida na hora de pagar fica no cadastro — quem paga vê o
   * erro do IXC na tela e acerta ali mesmo, e da próxima vez já vem certa.
   */
  private async decorarPix(
    beneficiario: BeneficiarioAvulso,
    dto: PagarAvulsoDto,
  ): Promise<BeneficiarioAvulso> {
    const chavePix = dto.chavePix?.trim();
    const tipoChavePix = dto.tipoChavePix ?? null;
    const mudou =
      (chavePix !== undefined && chavePix !== (beneficiario.chavePix ?? '')) ||
      (dto.tipoChavePix !== undefined &&
        tipoChavePix !== beneficiario.tipoChavePix);
    if (!mudou) return beneficiario;

    return this.prisma.beneficiarioAvulso.update({
      where: { id: beneficiario.id },
      data: {
        ...(chavePix === undefined ? {} : { chavePix: chavePix || null }),
        ...(dto.tipoChavePix === undefined ? {} : { tipoChavePix }),
      },
    });
  }

  /** Conta a pagar no IXC (o caminho já usado pela folha e pelas diárias). */
  private async pagarPeloIxc(
    base: Prisma.PagamentoAvulsoUncheckedCreateInput,
    partes: PartesDoPagamento,
    usuarioId?: string,
  ): Promise<PagamentoAvulso> {
    const [conta] = await this.contasPagar.criar(
      {
        itens: [
          {
            beneficiarioAvulsoId: base.beneficiarioId,
            tipo: TipoLancamento.AVULSO,
            valor: Number(base.valor),
            contaContabil: base.contaContabil,
            observacao: montarObservacaoPagamento({
              ...partes,
              descricao: base.descricao,
            }),
          },
        ],
      },
      usuarioId,
    );

    const pagamento = await this.prisma.pagamentoAvulso.create({
      data: { ...base, contaPagarId: conta.id },
      include: {
        contaPagar: {
          select: { id: true, status: true, erro: true, idFnApagarIxc: true },
        },
      },
    });

    // Só agora o fornecedor existe (foi criado ao mandar a conta a pagar), e é
    // agora que a chave digitada aqui pode subir para os dados bancários dele.
    // Sem estourar: o pagamento já foi feito, e a chave foi junto no payload.
    const salvo = await this.buscar(base.beneficiarioId);
    const aviso = await this.espelharPix(salvo);
    if (aviso) this.logger.warn(aviso);

    return pagamento;
  }

  /**
   * Dinheiro entregue na mão: o pagamento nasce pago e a saída é lançada no
   * caixa do IXC. Se o lançamento não sair, o registro **não** se perde — fica
   * com o motivo guardado, para tentar de novo ou lançar à mão.
   */
  private async pagarEmMaos(
    beneficiario: BeneficiarioAvulso,
    base: Prisma.PagamentoAvulsoUncheckedCreateInput,
  ): Promise<PagamentoAvulso> {
    const cfg = await this.config.obter();
    const caixaId = await this.caixa.resolverCaixa(cfg);

    const pagamento = await this.prisma.pagamentoAvulso.create({
      data: {
        ...base,
        caixaIxc: caixaId,
        erroIxc: caixaId
          ? null
          : `Não achei o caixa "${cfg.caixaEmMaosNome}" no IXC. ` +
            'Informe o código dele em Configurações e lance de novo.',
      },
    });

    return caixaId ? this.lancarNoCaixa(pagamento.id) : pagamento;
  }

  /**
   * Lança (ou tenta de novo) a saída no caixa do IXC. É o botão de "tentar de
   * novo" da tela: erro de rede, tabela recém-configurada, caixa que acabou de
   * ser informado.
   */
  async lancarNoCaixa(pagamentoId: string): Promise<PagamentoAvulso> {
    const pagamento = await this.buscarPagamento(pagamentoId);
    if (pagamento.forma !== FormaPagamento.EM_MAOS) {
      throw new BadRequestException(
        'Só pagamento em mãos sai do caixa — este foi pelo IXC.',
      );
    }
    if (pagamento.idLancamentoIxc) {
      throw new BadRequestException(
        `Este pagamento já saiu do caixa no IXC (lançamento ${pagamento.idLancamentoIxc}).`,
      );
    }

    const cfg = await this.config.obter();
    const caixaId = pagamento.caixaIxc ?? (await this.caixa.resolverCaixa(cfg));
    if (!caixaId) {
      return this.marcarErro(
        pagamento.id,
        `Não achei o caixa "${cfg.caixaEmMaosNome}" no IXC. Informe o código em Configurações.`,
      );
    }

    const beneficiario = await this.buscar(pagamento.beneficiarioId);
    try {
      const res = await this.caixa.lancarSaida(
        {
          caixaId,
          valor: Number(pagamento.valor),
          data: pagamento.data,
          historico: montarHistoricoCaixa({
            nome: beneficiario.nome,
            descricao: pagamento.descricao,
            // O serviço é o que sobrou depois de tirar comissão e extra: é
            // assim que ele é guardado (só o total vai para a coluna `valor`).
            valorServico:
              Number(pagamento.valor) -
              Number(pagamento.comissaoVendas) -
              Number(pagamento.valorExtra),
            vendas: pagamento.vendas,
            valorPorVenda: Number(pagamento.valorPorVenda ?? 0),
            valorExtra: Number(pagamento.valorExtra),
            descricaoExtra: pagamento.descricaoExtra,
          }),
        },
        cfg,
      );

      return this.prisma.pagamentoAvulso.update({
        where: { id: pagamento.id },
        data: {
          caixaIxc: caixaId,
          idLancamentoIxc: res.id,
          lancadoEm: new Date(),
          lancadoManual: false,
          erroIxc: res.aviso ?? null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Pagamento ${pagamento.id} não saiu do caixa no IXC: ${message}`,
      );
      return this.marcarErro(pagamento.id, message);
    }
  }

  /** Marca que alguém lançou a saída no IXC à mão. */
  async marcarLancadoManual(pagamentoId: string): Promise<PagamentoAvulso> {
    const pagamento = await this.buscarPagamento(pagamentoId);
    if (pagamento.forma !== FormaPagamento.EM_MAOS) {
      throw new BadRequestException('Só pagamento em mãos sai do caixa.');
    }
    return this.prisma.pagamentoAvulso.update({
      where: { id: pagamento.id },
      data: { lancadoManual: true, lancadoEm: new Date(), erroIxc: null },
    });
  }

  /**
   * Apaga o pagamento. Pelo IXC, apaga também a conta a pagar (dos dois lados).
   * Em mãos com lançamento já feito no caixa, recusa: apagar aqui deixaria a
   * saída solta no IXC.
   */
  async removerPagamento(pagamentoId: string): Promise<void> {
    const pagamento = await this.buscarPagamento(pagamentoId);

    if (pagamento.idLancamentoIxc) {
      throw new BadRequestException(
        `A saída deste pagamento já está lançada no caixa do IXC (lançamento ` +
          `${pagamento.idLancamentoIxc}). Apague por lá primeiro.`,
      );
    }
    if (pagamento.contaPagarId) {
      await this.contasPagar.remover(pagamento.contaPagarId);
    }
    await this.prisma.pagamentoAvulso.delete({ where: { id: pagamento.id } });
  }

  private async buscarPagamento(id: string): Promise<PagamentoAvulso> {
    const p = await this.prisma.pagamentoAvulso.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    return p;
  }

  private marcarErro(id: string, erro: string): Promise<PagamentoAvulso> {
    return this.prisma.pagamentoAvulso.update({
      where: { id },
      data: { erroIxc: erro },
    });
  }
}

/** Como cada pagamento aparece nas contas do resumo. */
interface PagamentoResumido {
  valor: Prisma.Decimal;
  forma: FormaPagamento;
  contaPagar: { status: StatusContaPagar } | null;
}

/**
 * Dinheiro que de fato saiu. Em mãos saiu no ato — o lançamento no caixa é
 * escrituração, não pagamento. Pelo IXC, só quando o banco confirmou.
 */
function saiu(p: PagamentoResumido): boolean {
  return p.forma === FormaPagamento.EM_MAOS
    ? true
    : p.contaPagar?.status === StatusContaPagar.PAGO;
}

/** Lançado no IXC e ainda a caminho: nem pago, nem recusado. */
function aCaminho(p: PagamentoResumido): boolean {
  if (p.forma === FormaPagamento.EM_MAOS) return false;
  const status = p.contaPagar?.status;
  return (
    status !== undefined &&
    status !== StatusContaPagar.PAGO &&
    status !== StatusContaPagar.ERRO &&
    status !== StatusContaPagar.REPROVADO &&
    status !== StatusContaPagar.CANCELADO
  );
}

function somar(itens: Array<{ valor: Prisma.Decimal }>): number {
  return itens.reduce((s, i) => s + Number(i.valor), 0);
}

/** Pago em mãos que ainda não virou lançamento no caixa do IXC. */
function pendenteNoCaixa(p: {
  forma: FormaPagamento;
  idLancamentoIxc: number | null;
  lancadoManual: boolean;
}): boolean {
  return (
    p.forma === FormaPagamento.EM_MAOS &&
    p.idLancamentoIxc === null &&
    !p.lancadoManual
  );
}

function hojeUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
