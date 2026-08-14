import { Injectable, Logger } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  estaEmAberto,
  mapContaAberta,
  ordenarPorUrgencia,
  resumirContasAbertas,
  type ContaAberta,
  type ResumoContasAbertas,
} from './contas-abertas.mapper';

/** O que a tela recebe de uma vez. */
export interface ContasAbertasResposta {
  contas: ContaAberta[];
  resumo: ResumoContasAbertas;
  /** Quando a lista foi lida do IXC — ela é de agora, não de um espelho */
  lidoEm: Date;
  /** O que não deu para completar, sem derrubar a lista */
  avisos: string[];
}

/**
 * Quantos títulos a lista aceita puxar de uma vez. Um provedor com anos de
 * histórico tem muita conta; o teto existe para uma base grande não travar a
 * tela — e o aviso conta que houve corte, em vez de mostrar um total errado
 * como se fosse o total.
 */
const TETO_DE_TITULOS = 3000;

/** De quanto em quanto tempo vale reler o cadastro de fornecedores. */
const VALIDADE_DO_INDICE_MS = 5 * 60 * 1000;

/**
 * As contas a pagar em aberto da empresa, lidas do IXC na hora.
 *
 * Não há cópia local de propósito: conta em aberto é o estado mais volátil que
 * existe no financeiro — alguém paga uma no caixa e ela deixa de ser devida no
 * mesmo minuto. Um espelho aqui estaria errado na maior parte do dia, e um
 * número errado sobre quanto se deve é pior que número nenhum.
 */
@Injectable()
export class ContasAbertasService {
  private readonly logger = new Logger(ContasAbertasService.name);

  /** Nome dos fornecedores, guardado por alguns minutos entre uma tela e outra. */
  private indiceFornecedores: { em: number; nomes: Map<number, string> } | null =
    null;

  constructor(
    private readonly ixc: IxcClient,
    private readonly prisma: PrismaService,
  ) {}

  async listar(): Promise<ContasAbertasResposta> {
    const avisos: string[] = [];

    const brutos = await this.ixc.listAll<Record<string, unknown>>(
      'fn_apagar',
      {
        // "A" é aberto. A conferência de novo acontece no `estaEmAberto`: base
        // que ignore o filtro devolve tudo, e aí é aqui que a conta paga cai
        // fora.
        qtype: 'fn_apagar.status',
        query: 'A',
        oper: '=',
        sortname: 'fn_apagar.data_vencimento',
        sortorder: 'asc',
      },
      { pageSize: 500, maxPages: TETO_DE_TITULOS / 500 },
    );

    if (brutos.length >= TETO_DE_TITULOS) {
      avisos.push(
        `A lista parou em ${TETO_DE_TITULOS} títulos. Há mais contas em aberto ` +
          'no IXC do que cabe nesta tela — os totais abaixo são só do que veio.',
      );
    }

    const hoje = new Date();
    const contas = brutos
      .filter(estaEmAberto)
      .map((raw) => mapContaAberta(raw, hoje))
      .filter((c): c is ContaAberta => c !== null);

    await this.completarNomes(contas, avisos);
    await this.marcarOrigemNaFolha(contas);

    return {
      contas: ordenarPorUrgencia(contas),
      resumo: resumirContasAbertas(contas),
      lidoEm: hoje,
      avisos,
    };
  }

  /**
   * Preenche o nome de quem vai receber, quando o próprio `fn_apagar` não o
   * trouxe.
   *
   * Muitas bases já devolvem o nome na listagem, e aí isto não custa consulta
   * nenhuma. Onde não vem, o cadastro de fornecedores é lido inteiro uma vez e
   * fica guardado por alguns minutos — é uma consulta a mais por tela, não uma
   * por conta, que numa lista de centenas de títulos seria a tela inteira
   * parada esperando o IXC.
   */
  private async completarNomes(
    contas: ContaAberta[],
    avisos: string[],
  ): Promise<void> {
    const faltando = contas.filter(
      (c) => !c.fornecedor.nome && c.fornecedor.id !== null,
    );
    if (faltando.length === 0) return;

    let nomes: Map<number, string>;
    try {
      nomes = await this.nomesDosFornecedores();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Não deu para ler os fornecedores: ${message}`);
      avisos.push(
        'Não consegui ler o cadastro de fornecedores do IXC, então algumas ' +
          'contas aparecem sem o nome de quem recebe.',
      );
      return;
    }

    for (const conta of faltando) {
      conta.fornecedor.nome =
        nomes.get(conta.fornecedor.id!) ?? `Fornecedor ${conta.fornecedor.id}`;
    }
  }

  private async nomesDosFornecedores(): Promise<Map<number, string>> {
    const agora = Date.now();
    if (
      this.indiceFornecedores &&
      agora - this.indiceFornecedores.em < VALIDADE_DO_INDICE_MS
    ) {
      return this.indiceFornecedores.nomes;
    }

    // Todos, não só os ativos: uma conta antiga em aberto pode ser de
    // fornecedor já desativado, e ela continua sendo devida.
    const registros = await this.ixc.listAll<Record<string, unknown>>(
      'fornecedor',
      { qtype: 'fornecedor.id', query: '0', oper: '>' },
      { pageSize: 500, maxPages: 20 },
    );

    const nomes = new Map<number, string>();
    for (const raw of registros) {
      const id = Number(raw.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      const nome = String(raw.razao ?? raw.fantasia ?? '').trim();
      if (nome) nomes.set(id, nome);
    }

    this.indiceFornecedores = { em: agora, nomes };
    this.logger.log(`Índice de fornecedores refeito: ${nomes.size} nomes.`);
    return nomes;
  }

  /**
   * Marca as contas que nasceram aqui. A mesma dívida aparece nas duas telas —
   * é uma só, e o IXC é quem a guarda —, então o selo existe para ninguém
   * achar que a folha está sendo cobrada duas vezes.
   */
  private async marcarOrigemNaFolha(contas: ContaAberta[]): Promise<void> {
    const ids = contas.map((c) => c.idFnApagar);
    if (ids.length === 0) return;

    const nossas = await this.prisma.contaPagar.findMany({
      where: { idFnApagarIxc: { in: ids } },
      select: {
        id: true,
        idFnApagarIxc: true,
        tipo: true,
        funcionario: { select: { nome: true } },
        diarista: { select: { nome: true } },
        beneficiarioAvulso: { select: { nome: true } },
      },
    });

    const porFnApagar = new Map(nossas.map((c) => [c.idFnApagarIxc, c]));
    for (const conta of contas) {
      const nossa = porFnApagar.get(conta.idFnApagar);
      if (!nossa) continue;
      conta.origem = {
        tipo: nossa.tipo,
        contaId: nossa.id,
        beneficiario:
          nossa.funcionario?.nome ??
          nossa.diarista?.nome ??
          nossa.beneficiarioAvulso?.nome ??
          null,
      };
    }
  }
}
