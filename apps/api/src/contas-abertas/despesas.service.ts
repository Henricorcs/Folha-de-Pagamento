import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ContaPagar } from '@prisma/client';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { CategoriasService } from './categorias.service';
import { CriarDespesaDto } from './dto/despesa.dto';
import { PagamentosService } from './pagamentos.service';

/** O que aconteceu ao dar por paga a conta recém-lançada. */
export interface BaixaDoLancamento {
  /** Quantas contas ficaram quitadas no IXC. */
  pagas: number;
  /** Quantas se tentou baixar — passa de uma quando é parcelado. */
  tentadas: number;
  /** Total que o IXC deu por pago. */
  valor: number;
  /** Dia que ficou registrado na baixa (AAAA-MM-DD). */
  data: string;
  /** O que não saiu como esperado. Vazio = correu tudo bem. */
  avisos: string[];
}

/** O que aconteceu ao lançar uma despesa à mão. */
export interface DespesaLancada {
  /** A primeira conta criada — a única, quando não é parcelado. */
  conta: ContaPagar;
  /** Todas as contas criadas: uma por parcela. */
  contas: ContaPagar[];
  /**
   * Por que a etiqueta não ficou, quando não ficou. A conta já existe no IXC
   * nesse caso — o que falta é só a classificação daqui, e ela se resolve na
   * própria lista de contas em aberto.
   */
  avisoCategoria: string | null;
  /** Null quando o lançamento não pediu para já sair pago. */
  baixa: BaixaDoLancamento | null;
}

/**
 * Lançar uma conta a pagar à mão, sem passar pela folha.
 *
 * Fica no módulo de contas em aberto porque é dali que ela nasce, na tela em
 * que se olha o que a empresa deve. O trabalho pesado continua no
 * `ContasPagarService` — é o mesmo caminho até o `fn_apagar` que a folha usa,
 * com a mesma auditoria e o mesmo acompanhamento do pagamento.
 */
@Injectable()
export class DespesasService {
  private readonly logger = new Logger(DespesasService.name);

  constructor(
    private readonly contasPagar: ContasPagarService,
    private readonly categorias: CategoriasService,
    private readonly pagamentos: PagamentosService,
  ) {}

  async lancar(
    dto: CriarDespesaDto,
    usuarioId?: string,
    usuarioNome?: string,
  ): Promise<DespesaLancada> {
    const hoje = hojeUtc();
    const emissao = dto.dataEmissao ? dataUtc(dto.dataEmissao) : hoje;

    /** O que é igual em todas as parcelas. */
    const comum = {
      idFornecedorIxc: dto.idFornecedorIxc,
      fornecedorNome: dto.fornecedorNome.trim(),
      dataEmissao: emissao,
      contaContabil: dto.contaContabil,
      contaPagamento: dto.contaPagamento,
      tipoPagamentoIxc: dto.tipoPagamento,
      numeroNota: dto.numeroNota,
      chavePix: dto.chavePix,
      tipoChavePix: dto.tipoChavePix,
    };

    let lancada: DespesaLancada;
    if (!dto.parcelas?.length) {
      const conta = await this.contasPagar.criarDespesa(
        {
          ...comum,
          valor: dto.valor,
          dataVencimento: dto.dataVencimento ? dataUtc(dto.dataVencimento) : hoje,
          observacao: dto.observacao.trim(),
          codigoBarras: dto.codigoBarras,
          documento: dto.documento,
        },
        usuarioId,
      );

      lancada = {
        conta,
        contas: [conta],
        avisoCategoria: await this.etiquetar(
          conta,
          dto.categoriaId ?? null,
          usuarioId,
        ),
        baixa: null,
      };
    } else {
      lancada = await this.lancarParcelas(dto, comum, usuarioId);
    }

    // A baixa vem por último e nunca derruba o lançamento: a conta já existe no
    // IXC a esta altura, e desfazê-la para "cancelar" a baixa que falhou
    // deixaria o pior dos dois mundos — nada registrado aqui e um título órfão
    // lá. Não dando, quem lançou recebe o aviso e paga pela lista, onde o botão
    // faz exatamente esta mesma chamada.
    if (!dto.jaPaga) return lancada;

    return {
      ...lancada,
      baixa: await this.darPorPaga(lancada.contas, dto, usuarioNome),
    };
  }

  /**
   * Dá por pagas as contas que acabaram de ser criadas — aprovação na auditoria
   * e baixa no IXC, na data em que o dinheiro saiu de fato.
   *
   * É o caminho de quem pagou o boleto pelo aplicativo do banco e só depois veio
   * lançar. Sem isto o lançamento nasce em aberto, alguém tem de lembrar de
   * voltar para aprová-lo e baixá-lo, e enquanto isso a conta fica na fila de
   * pagamento como se ainda devesse — que é como o mesmo dinheiro sai duas
   * vezes.
   *
   * Parcelado, todas as parcelas são baixadas: quem marca "já foi paga" num
   * lançamento parcelado está registrando um acerto que já saiu inteiro.
   */
  private async darPorPaga(
    contas: ContaPagar[],
    dto: CriarDespesaDto,
    usuarioNome?: string,
  ): Promise<BaixaDoLancamento> {
    const data =
      dto.dataPagamento ??
      dto.dataVencimento ??
      new Date().toISOString().slice(0, 10);

    const baixa: BaixaDoLancamento = {
      pagas: 0,
      tentadas: contas.length,
      valor: 0,
      data,
      avisos: [],
    };

    for (const [i, conta] of contas.entries()) {
      const comoChamar =
        contas.length > 1 ? `A parcela ${i + 1} de ${contas.length}` : 'A conta';

      if (!conta.idFnApagarIxc) {
        baixa.avisos.push(
          `${comoChamar} não recebeu número do IXC, então não deu para dá-la ` +
            'por paga. Ela continua em aberto lá.',
        );
        continue;
      }

      try {
        const r = await this.pagamentos.pagar(
          conta.idFnApagarIxc,
          {
            contaPagamento: dto.contaPagamento,
            data,
            historico: `Pago antes do lançamento — ${dto.observacao.trim()}`.slice(0, 200),
            // O dinheiro saiu antes de o título existir: não há pagamento do
            // banco a esperar, nem na conta que ele costuma pagar.
            jaSaiu: true,
          },
          usuarioNome,
        );

        if (r.paga) {
          baixa.pagas += 1;
          baixa.valor += r.valor;
        } else {
          baixa.avisos.push(
            `${comoChamar} foi aprovada no IXC, mas ele não a deu por paga. ` +
              'Confira por lá antes de considerar essa conta quitada.',
          );
        }
        baixa.avisos.push(...r.avisos.map((a) => `${comoChamar}: ${a}`));
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Conta ${conta.id} foi lançada, mas a baixa não saiu: ${motivo}`,
        );
        baixa.avisos.push(
          `${comoChamar} foi lançada no IXC, mas não ficou paga (${motivo}). ` +
            'Pague-a pela lista de contas em aberto.',
        );
      }
    }

    this.logger.log(
      `Lançamento já pago: ${baixa.pagas}/${baixa.tentadas} conta(s) baixadas ` +
        `no IXC em ${data}.`,
    );
    return baixa;
  }

  /**
   * A nota em vezes: uma conta a pagar por parcela no IXC.
   *
   * As parcelas vão uma a uma, e o que já entrou fica de pé se a seguinte
   * falhar. Desfazer as anteriores seria pior: elas já existem no IXC, e o
   * conserto de "faltou a parcela 4" é lançar a 4 — enquanto o de "sumiram as
   * três primeiras" é conferir seis registros do outro lado.
   */
  private async lancarParcelas(
    dto: CriarDespesaDto,
    comum: Record<string, unknown>,
    usuarioId?: string,
  ): Promise<DespesaLancada> {
    const parcelas = dto.parcelas!;
    const criadas: ContaPagar[] = [];
    const avisos: string[] = [];

    for (const [i, parcela] of parcelas.entries()) {
      // "3/6" na observação é o que permite reconhecer a parcela na lista do
      // IXC, onde todas aparecem com o mesmo fornecedor e o mesmo texto. Num
      // consórcio já em andamento a numeração vem pronta da tela, porque ali a
      // primeira a lançar pode ser a 13 de 120.
      const numero = parcela.rotulo || `${i + 1}/${parcelas.length}`;
      const observacao = `${dto.observacao.trim()} (${numero})`.slice(0, 500);

      try {
        const conta = await this.contasPagar.criarDespesa(
          {
            ...(comum as Parameters<
              typeof this.contasPagar.criarDespesa
            >[0]),
            valor: parcela.valor,
            dataVencimento: dataUtc(parcela.dataVencimento),
            observacao,
            codigoBarras: parcela.codigoBarras ?? null,
            documento: parcela.documento ?? dto.documento ?? null,
          },
          usuarioId,
        );
        criadas.push(conta);

        const aviso = await this.etiquetar(
          conta,
          dto.categoriaId ?? null,
          usuarioId,
        );
        if (aviso) avisos.push(`Parcela ${i + 1}: ${aviso}`);
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Parcela ${i + 1}/${parcelas.length} não foi criada: ${motivo}`,
        );
        avisos.push(
          `A parcela ${i + 1} de ${parcelas.length} não foi criada (${motivo}). ` +
            `As ${criadas.length} anteriores já estão no IXC — lance esta ` +
            'de novo sozinha.',
        );
        break;
      }
    }

    if (criadas.length === 0) {
      throw new BadRequestException(
        avisos[0] ?? 'Nenhuma parcela pôde ser criada.',
      );
    }

    return {
      conta: criadas[0],
      contas: criadas,
      avisoCategoria: avisos.length ? avisos.join(' ') : null,
      baixa: null,
    };
  }

  /**
   * A etiqueta só pode ser gravada depois que o IXC devolve o número do título
   * — é por ele que a classificação se liga ao débito, e ele não existe antes
   * do envio.
   *
   * Falhar aqui não derruba o lançamento: a conta já está no IXC e apagá-la
   * para "desfazer" seria arriscar deixar o registro de lá vivo e o daqui não.
   * Quem lançou recebe o aviso e classifica pela lista, em dois cliques.
   */
  private async etiquetar(
    conta: ContaPagar,
    categoriaId: string | null,
    usuarioId?: string,
  ): Promise<string | null> {
    if (!categoriaId) return null;

    if (!conta.idFnApagarIxc) {
      return (
        'A conta não recebeu número do IXC, então a categoria não pôde ser ' +
        'gravada. Assim que o envio for refeito, classifique pela lista.'
      );
    }

    try {
      await this.categorias.classificar(
        conta.idFnApagarIxc,
        categoriaId,
        usuarioId,
      );
      return null;
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Despesa ${conta.id} foi lançada, mas a categoria não ficou: ${motivo}`,
      );
      return `A conta foi lançada no IXC, mas a categoria não ficou (${motivo}). Escolha-a na lista.`;
    }
  }
}

/**
 * "AAAA-MM-DD" → meia-noite em UTC. As datas desta base são gravadas assim e
 * lidas assim na hora de virar "DD/MM/AAAA" para o IXC; converter pelo fuso
 * local faria a conta lançada de madrugada sair com a data do dia anterior.
 */
function dataUtc(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function hojeUtc(): Date {
  const agora = new Date();
  return new Date(
    Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()),
  );
}
