import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Diaria,
  Diarista,
  FormaPagamento,
  Prisma,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { CaixaService } from '../ixc/caixa.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  calcularTotalDiaria,
  montarHistoricoCaixa,
  montarObservacaoDiaria,
} from './diarias.calc';
import { PagarDiariaDto } from './dto/diaria.dto';
import { CriarDiaristaDto, UpdateDiaristaDto } from './dto/diarista.dto';

/** Diarista com o que a listagem precisa mostrar sem abrir o cadastro. */
export interface DiaristaComResumo {
  diarista: Diarista;
  /** Quantas diárias existem no histórico dessa pessoa (pagas ou não). */
  quantidadeDiarias: number;
  /** Só o dinheiro que de fato saiu: em mãos, ou conta a pagar já PAGA. */
  totalPago: number;
  /** Quantas dessas diárias entraram no total pago. */
  quantidadePagas: number;
  /** Lançado no IXC e ainda a caminho do banco (aprovação, pagamento). */
  totalAguardando: number;
  quantidadeAguardando: number;
  /** Contas a pagar que o IXC recusou — não saíram e precisam de correção. */
  quantidadeComErro: number;
  ultimaDiaria: Date | null;
  /** Diárias em mãos que ainda não viraram lançamento no caixa do IXC. */
  pendentesNoCaixa: number;
}

/** O que aconteceu ao apagar várias diárias de uma vez. */
export interface ResultadoLoteDiarias {
  total: number;
  sucesso: number;
  falhas: Array<{ id: string; erro: string }>;
}

/**
 * Status de conta a pagar que não vira dinheiro saindo. Junto com "sem conta
 * nenhuma" (a que foi apagada no IXC), é o que define uma diária travada.
 */
const SEM_SAIDA: StatusContaPagar[] = [
  StatusContaPagar.REPROVADO,
  StatusContaPagar.CANCELADO,
  StatusContaPagar.ERRO,
];

@Injectable()
export class DiaristasService {
  private readonly logger = new Logger(DiaristasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigFinanceiraService,
    private readonly contasPagar: ContasPagarService,
    private readonly caixa: CaixaService,
  ) {}

  // -------------------------------------------------------------------------
  // Cadastro
  // -------------------------------------------------------------------------
  async listar(busca?: string, todos = false): Promise<DiaristaComResumo[]> {
    const where: Prisma.DiaristaWhereInput = {};
    if (!todos) where.ativo = true;
    if (busca) {
      // A fantasia entra na busca porque é por ela que a pessoa é conhecida:
      // procura-se "Deda pedreiro", não "Antonio Clebes Alves da Silva".
      where.OR = [
        { nome: { contains: busca, mode: 'insensitive' } },
        { nomeFantasia: { contains: busca, mode: 'insensitive' } },
        { cpfCnpj: { contains: busca, mode: 'insensitive' } },
      ];
    }

    const diaristas = await this.prisma.diarista.findMany({
      where,
      orderBy: { nome: 'asc' },
      include: {
        diarias: {
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

    return diaristas.map(({ diarias, ...diarista }) => {
      const pagas = diarias.filter((d) => diariaPaga(d));
      const aguardando = diarias.filter((d) => diariaAguardando(d));

      return {
        diarista,
        quantidadeDiarias: diarias.length,
        totalPago: somar(pagas),
        quantidadePagas: pagas.length,
        totalAguardando: somar(aguardando),
        quantidadeAguardando: aguardando.length,
        quantidadeComErro: diarias.filter(
          (d) => d.contaPagar?.status === StatusContaPagar.ERRO,
        ).length,
        ultimaDiaria: diarias.reduce<Date | null>(
          (maior, d) => (!maior || d.data > maior ? d.data : maior),
          null,
        ),
        pendentesNoCaixa: diarias.filter((d) => pendenteNoCaixa(d)).length,
      };
    });
  }

  async buscar(id: string): Promise<Diarista> {
    const d = await this.prisma.diarista.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Diarista não encontrado');
    return d;
  }

  criar(dto: CriarDiaristaDto): Promise<Diarista> {
    return this.prisma.diarista.create({
      // O nome vai explícito: no cadastro novo ele é obrigatório, na edição não.
      data: { ...this.dadosDoCadastro(dto), nome: dto.nome.trim() },
    });
  }

  async atualizar(id: string, dto: UpdateDiaristaDto): Promise<Diarista> {
    await this.buscar(id);
    return this.prisma.diarista.update({
      where: { id },
      data: {
        ...this.dadosDoCadastro(dto),
        ...(dto.ativo === undefined ? {} : { ativo: dto.ativo }),
      },
    });
  }

  /**
   * Apaga o cadastro. Quem já recebeu não é apagado: o histórico de pagamento
   * tem de continuar existindo, então o caminho é desativar.
   */
  async remover(id: string): Promise<void> {
    const diarias = await this.prisma.diaria.count({ where: { diaristaId: id } });
    if (diarias > 0) {
      throw new BadRequestException(
        `${diarias} diária(s) já foram pagas a essa pessoa — desative o cadastro em vez de apagar.`,
      );
    }
    await this.buscar(id);
    await this.prisma.diarista.delete({ where: { id } });
  }

  private dadosDoCadastro(dto: CriarDiaristaDto) {
    return {
      ...(dto.nome === undefined ? {} : { nome: dto.nome.trim() }),
      ...(dto.nomeFantasia === undefined
        ? {}
        : { nomeFantasia: dto.nomeFantasia.trim() || null }),
      ...(dto.cpfCnpj === undefined ? {} : { cpfCnpj: dto.cpfCnpj || null }),
      ...(dto.telefone === undefined ? {} : { telefone: dto.telefone || null }),
      ...(dto.banco === undefined ? {} : { banco: dto.banco || null }),
      ...(dto.agencia === undefined ? {} : { agencia: dto.agencia || null }),
      ...(dto.conta === undefined ? {} : { conta: dto.conta || null }),
      ...(dto.chavePix === undefined ? {} : { chavePix: dto.chavePix || null }),
      ...(dto.tipoChavePix === undefined
        ? {}
        : { tipoChavePix: dto.tipoChavePix }),
      ...(dto.valorDiaria === undefined
        ? {}
        : {
            valorDiaria:
              dto.valorDiaria == null || dto.valorDiaria <= 0
                ? null
                : new Prisma.Decimal(dto.valorDiaria),
          }),
      ...(dto.formaPagamento === undefined
        ? {}
        : { formaPagamento: dto.formaPagamento }),
      ...(dto.observacoes === undefined
        ? {}
        : { observacoes: dto.observacoes || null }),
      ...(dto.cidadeIxc === undefined ? {} : { cidadeIxc: dto.cidadeIxc }),
    };
  }

  // -------------------------------------------------------------------------
  // Diárias
  // -------------------------------------------------------------------------
  listarDiarias(diaristaId?: string) {
    return this.prisma.diaria.findMany({
      where: diaristaId ? { diaristaId } : undefined,
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: {
        diarista: { select: { nome: true } },
        contaPagar: {
          select: { id: true, status: true, erro: true, idFnApagarIxc: true },
        },
      },
    });
  }

  /**
   * As diárias que ficaram no meio do caminho: pagas pelo IXC, mas com a conta
   * a pagar reprovada, cancelada, recusada — ou apagada de lá, que é o que
   * deixa a diária sem conta nenhuma.
   *
   * Nenhuma delas vai sair sozinha, então ficam fora do gasto do mês. Existe
   * esta lista para não ficarem fora *e* invisíveis: ou alguém refaz o
   * pagamento, ou apaga o registro.
   */
  listarTravadas() {
    return this.prisma.diaria.findMany({
      where: {
        forma: FormaPagamento.IXC,
        OR: [
          { contaPagarId: null },
          { contaPagar: { status: { in: SEM_SAIDA } } },
        ],
      },
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        diarista: { select: { nome: true } },
        contaPagar: {
          select: { id: true, status: true, erro: true, idFnApagarIxc: true },
        },
      },
    });
  }

  /**
   * Apaga várias diárias de uma vez. Uma que falhe não derruba as outras — o
   * relatório diz quais ficaram e por quê, como nas ações em massa das contas.
   */
  async removerDiarias(ids: string[]): Promise<ResultadoLoteDiarias> {
    const unicos = [...new Set(ids)];
    const falhas: Array<{ id: string; erro: string }> = [];
    let sucesso = 0;

    for (const id of unicos) {
      try {
        await this.removerDiaria(id);
        sucesso++;
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        falhas.push({ id, erro });
        this.logger.warn(`Diária ${id} não foi apagada: ${erro}`);
      }
    }
    return { total: unicos.length, sucesso, falhas };
  }

  /**
   * Paga uma diária. Pelo IXC vira conta a pagar como qualquer beneficiário
   * (fornecedor, auditoria, banco). Em mãos, o dinheiro já saiu da gaveta: a
   * diária é registrada como paga e o app lança a saída no caixa configurado.
   */
  async pagar(
    diaristaId: string,
    dto: PagarDiariaDto,
    usuarioId?: string,
  ): Promise<Diaria> {
    const diarista = await this.decorarPix(
      await this.buscar(diaristaId),
      dto,
    );
    const forma = dto.forma ?? diarista.formaPagamento;

    const quantidade = dto.quantidade ?? 1;
    const valorDiaria = dto.valorDiaria ?? Number(diarista.valorDiaria ?? 0);
    if (valorDiaria <= 0 && !dto.valor) {
      throw new BadRequestException(
        'Informe o valor da diária (ou um valor total) — o cadastro não tem valor combinado.',
      );
    }
    const valor = calcularTotalDiaria({ quantidade, valorDiaria, valor: dto.valor });
    if (valor < 0.01) {
      throw new BadRequestException('O valor da diária tem de ser maior que zero');
    }

    const data = dto.data ? new Date(dto.data) : hojeUtc();
    const base = {
      diaristaId,
      data,
      quantidade: new Prisma.Decimal(quantidade),
      valorDiaria: new Prisma.Decimal(valorDiaria || valor),
      valor: new Prisma.Decimal(valor),
      descricao: dto.descricao.trim(),
      forma,
      criadoPor: usuarioId ?? null,
    };

    return forma === FormaPagamento.IXC
      ? this.pagarPeloIxc(diarista, base, { quantidade, valorDiaria, valor }, usuarioId)
      : this.pagarEmMaos(base);
  }

  /**
   * A chave PIX corrigida na hora de pagar fica no cadastro. Quem paga vê o
   * erro do IXC na tela e acerta ali mesmo; da próxima vez já vem certo, sem
   * depender de arrumar o fornecedor no IXC e sincronizar de novo.
   */
  private async decorarPix(
    diarista: Diarista,
    dto: PagarDiariaDto,
  ): Promise<Diarista> {
    const chavePix = dto.chavePix?.trim();
    const tipoChavePix = dto.tipoChavePix ?? null;
    const mudou =
      (chavePix !== undefined && chavePix !== (diarista.chavePix ?? '')) ||
      (dto.tipoChavePix !== undefined &&
        tipoChavePix !== diarista.tipoChavePix);
    if (!mudou) return diarista;

    return this.prisma.diarista.update({
      where: { id: diarista.id },
      data: {
        ...(chavePix === undefined ? {} : { chavePix: chavePix || null }),
        ...(dto.tipoChavePix === undefined ? {} : { tipoChavePix }),
      },
    });
  }

  /** Conta a pagar no IXC (o caminho já usado pela folha e pelos avulsos). */
  private async pagarPeloIxc(
    diarista: Diarista,
    base: Prisma.DiariaUncheckedCreateInput,
    numeros: { quantidade: number; valorDiaria: number; valor: number },
    usuarioId?: string,
  ): Promise<Diaria> {
    const observacao = montarObservacaoDiaria({
      descricao: base.descricao,
      quantidade: numeros.quantidade,
      valorDiaria: numeros.valorDiaria,
    });

    const [conta] = await this.contasPagar.criar(
      {
        itens: [
          {
            diaristaId: diarista.id,
            tipo: TipoLancamento.DIARIA,
            valor: numeros.valor,
            observacao,
          },
        ],
      },
      usuarioId,
    );

    return this.prisma.diaria.create({
      data: { ...base, contaPagarId: conta.id },
      include: {
        contaPagar: {
          select: { id: true, status: true, erro: true, idFnApagarIxc: true },
        },
      },
    });
  }

  /**
   * Dinheiro entregue na mão: a diária nasce paga e a saída é lançada no caixa
   * do IXC. Se o lançamento não sair, o registro **não** se perde — fica com o
   * motivo guardado, para tentar de novo ou lançar à mão. Dinheiro que saiu da
   * gaveta tem de estar escrito em algum lugar.
   */
  private async pagarEmMaos(
    base: Prisma.DiariaUncheckedCreateInput,
  ): Promise<Diaria> {
    const cfg = await this.config.obter();
    const caixaId = await this.caixa.resolverCaixa(cfg);

    const diaria = await this.prisma.diaria.create({
      data: {
        ...base,
        caixaIxc: caixaId,
        erroIxc: caixaId
          ? null
          : `Não achei o caixa "${cfg.caixaEmMaosNome}" no IXC. ` +
            'Informe o código dele em Configurações e lance de novo.',
      },
    });

    return caixaId ? this.lancarNoCaixa(diaria.id) : diaria;
  }

  /**
   * Lança (ou tenta de novo) a saída da diária no caixa do IXC. É o botão de
   * "tentar de novo" da tela: erro de rede, tabela recém-configurada, caixa que
   * acabou de ser informado.
   */
  async lancarNoCaixa(diariaId: string): Promise<Diaria> {
    const diaria = await this.buscarDiaria(diariaId);
    if (diaria.forma !== FormaPagamento.EM_MAOS) {
      throw new BadRequestException(
        'Só diária paga em mãos sai do caixa — esta foi paga pelo IXC.',
      );
    }
    if (diaria.idLancamentoIxc) {
      throw new BadRequestException(
        `Esta diária já saiu do caixa no IXC (lançamento ${diaria.idLancamentoIxc}).`,
      );
    }

    const cfg = await this.config.obter();
    const caixaId = diaria.caixaIxc ?? (await this.caixa.resolverCaixa(cfg));
    if (!caixaId) {
      return this.marcarErro(
        diaria.id,
        `Não achei o caixa "${cfg.caixaEmMaosNome}" no IXC. Informe o código em Configurações.`,
      );
    }

    const diarista = await this.buscar(diaria.diaristaId);
    try {
      const res = await this.caixa.lancarSaida(
        {
          caixaId,
          valor: Number(diaria.valor),
          data: diaria.data,
          historico: montarHistoricoCaixa({
            nome: diarista.nome,
            descricao: diaria.descricao,
            quantidade: Number(diaria.quantidade),
            valorDiaria: Number(diaria.valorDiaria),
          }),
        },
        cfg,
      );

      return this.prisma.diaria.update({
        where: { id: diaria.id },
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
        `Diária ${diaria.id} não saiu do caixa no IXC: ${message}`,
      );
      return this.marcarErro(diaria.id, message);
    }
  }

  /**
   * Marca que alguém lançou a saída no IXC à mão. Fecha a pendência sem fingir
   * que o app fez o lançamento.
   */
  async marcarLancadoManual(diariaId: string): Promise<Diaria> {
    const diaria = await this.buscarDiaria(diariaId);
    if (diaria.forma !== FormaPagamento.EM_MAOS) {
      throw new BadRequestException('Só diária paga em mãos sai do caixa.');
    }
    return this.prisma.diaria.update({
      where: { id: diaria.id },
      data: { lancadoManual: true, lancadoEm: new Date(), erroIxc: null },
    });
  }

  /**
   * Apaga a diária. Pelo IXC, apaga também a conta a pagar (dos dois lados,
   * como na tela de contas a pagar). Em mãos com lançamento já feito no caixa,
   * recusa: apagar aqui deixaria a saída solta no IXC.
   */
  async removerDiaria(diariaId: string): Promise<void> {
    const diaria = await this.buscarDiaria(diariaId);

    if (diaria.idLancamentoIxc) {
      throw new BadRequestException(
        `A saída desta diária já está lançada no caixa do IXC (lançamento ` +
          `${diaria.idLancamentoIxc}). Apague por lá primeiro.`,
      );
    }
    if (diaria.contaPagarId) {
      // Apaga o fn_apagar no IXC e o registro daqui; se o IXC recusar, nada sai.
      await this.contasPagar.remover(diaria.contaPagarId);
    }
    await this.prisma.diaria.delete({ where: { id: diaria.id } });
  }

  private async buscarDiaria(id: string): Promise<Diaria> {
    const d = await this.prisma.diaria.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Diária não encontrada');
    return d;
  }

  private marcarErro(id: string, erro: string): Promise<Diaria> {
    return this.prisma.diaria.update({ where: { id }, data: { erroIxc: erro } });
  }
}

/** Como cada diária aparece nas contas do resumo. */
interface DiariaResumida {
  valor: Prisma.Decimal;
  forma: FormaPagamento;
  contaPagar: { status: StatusContaPagar } | null;
}

/**
 * Dinheiro que de fato saiu.
 *
 * Em mãos já saiu no ato — o lançamento no caixa do IXC é escrituração, não
 * pagamento. Pelo IXC, só quando o banco confirmou: enquanto a conta espera
 * aprovação (ou foi recusada) o diarista ainda não recebeu nada, e mostrar
 * isso como pago faria a tela mentir.
 */
function diariaPaga(d: DiariaResumida): boolean {
  return d.forma === FormaPagamento.EM_MAOS
    ? true
    : d.contaPagar?.status === StatusContaPagar.PAGO;
}

/** Lançada no IXC e ainda a caminho: nem paga, nem recusada. */
function diariaAguardando(d: DiariaResumida): boolean {
  if (d.forma === FormaPagamento.EM_MAOS) return false;
  const status = d.contaPagar?.status;
  return (
    status !== undefined &&
    status !== StatusContaPagar.PAGO &&
    status !== StatusContaPagar.ERRO &&
    status !== StatusContaPagar.REPROVADO &&
    status !== StatusContaPagar.CANCELADO
  );
}

function somar(diarias: Array<{ valor: Prisma.Decimal }>): number {
  return diarias.reduce((s, d) => s + Number(d.valor), 0);
}

/** Diária em mãos que ainda não virou lançamento no caixa do IXC. */
function pendenteNoCaixa(d: {
  forma: FormaPagamento;
  idLancamentoIxc: number | null;
  lancadoManual: boolean;
}): boolean {
  return (
    d.forma === FormaPagamento.EM_MAOS &&
    d.idLancamentoIxc === null &&
    !d.lancadoManual
  );
}

function hojeUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
