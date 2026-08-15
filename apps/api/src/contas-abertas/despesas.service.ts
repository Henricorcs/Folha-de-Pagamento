import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ContaPagar } from '@prisma/client';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { CategoriasService } from './categorias.service';
import { CriarDespesaDto } from './dto/despesa.dto';

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
  ) {}

  async lancar(
    dto: CriarDespesaDto,
    usuarioId?: string,
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

      return {
        conta,
        contas: [conta],
        avisoCategoria: await this.etiquetar(
          conta,
          dto.categoriaId ?? null,
          usuarioId,
        ),
      };
    }

    return this.lancarParcelas(dto, comum, usuarioId);
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
      // IXC, onde todas aparecem com o mesmo fornecedor e o mesmo texto.
      const observacao =
        `${dto.observacao.trim()} (${i + 1}/${parcelas.length})`.slice(0, 500);

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
