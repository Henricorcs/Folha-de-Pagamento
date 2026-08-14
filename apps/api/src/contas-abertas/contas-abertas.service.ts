import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  explicarFiltro,
  mapContaAberta,
  motivoDeNaoEstarAberto,
  type AvaliacaoDoFiltro,
  ordenarPorUrgencia,
  resumirContasAbertas,
  type ContaAberta,
  type ResumoContasAbertas,
} from './contas-abertas.mapper';

/** O título do IXC por inteiro, com a leitura que o filtro daqui faz dele. */
export interface DetalheDoTitulo {
  campos: Record<string, unknown>;
  filtro: AvaliacaoDoFiltro;
}

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

/** De quanto em quanto tempo vale reler os cadastros de apoio. */
const VALIDADE_DO_INDICE_MS = 5 * 60 * 1000;

/**
 * Onde o plano de contas pode estar. O nome muda entre versões do IXC e a
 * documentação do webservice não fecha a lista, então testa-se um a um até
 * algum responder — o mesmo caminho da tabela de dados bancários.
 */
const TABELAS_PLANO_DE_CONTAS = [
  'fn_classificacao',
  'plano_contas',
  'fn_plano_contas',
  'fn_conta',
  'conta_despesa',
] as const;

/**
 * Conta em texto o que ficou de fora, por motivo e por coluna.
 *
 * "Pago" não vira aviso: título quitado sair da lista de contas em aberto é o
 * esperado, e dizer isso a cada leitura seria ruído. Cancelamento e quitação
 * por saldo viram, porque é neles que um filtro errado se esconde — foi um
 * deles que engoliu quatrocentos títulos de uma vez sem ninguém perceber.
 */
function explicarExclusoes(
  excluidos: Map<string, number>,
  totalLido: number,
): string[] {
  const avisos: string[] = [];

  for (const [chave, quantidade] of excluidos) {
    const [motivo, campo] = chave.split('|');
    if (motivo === 'pago') continue;

    const parte = ((quantidade / Math.max(totalLido, 1)) * 100).toFixed(0);
    if (motivo === 'cancelado') {
      avisos.push(
        `${quantidade} de ${totalLido} título(s) ficaram de fora por estarem ` +
          `cancelados no IXC (coluna "${campo}"). Se essas contas ainda são ` +
          `devidas, é essa coluna que está sendo lida errado — ela responde ` +
          `por ${parte}% do que o IXC devolveu.`,
      );
    } else if (motivo === 'quitado') {
      avisos.push(
        `${quantidade} título(s) vieram sem saldo a pagar e ficaram de fora.`,
      );
    }
  }

  return avisos;
}

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

  /** O mesmo para o plano de contas, que dá nome à categoria da despesa. */
  private indiceCategorias: { em: number; nomes: Map<number, string> } | null =
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

    // Cada título que fica de fora é contado pelo motivo e pela coluna que
    // decidiu. É o que faz um filtro errado aparecer na tela em vez de sumir
    // com a dívida caladamente — foi assim que se descobriu que uma regra
    // larga demais tinha engolido quatrocentos títulos de verdade.
    const excluidos = new Map<string, number>();
    const contas: ContaAberta[] = [];

    for (const raw of brutos) {
      const fora = motivoDeNaoEstarAberto(raw);
      if (fora) {
        const chave = `${fora.motivo}|${fora.campo}`;
        excluidos.set(chave, (excluidos.get(chave) ?? 0) + 1);
        continue;
      }
      const conta = mapContaAberta(raw, hoje);
      if (conta) contas.push(conta);
    }

    avisos.push(...explicarExclusoes(excluidos, brutos.length));

    await this.completarNomes(contas, avisos);
    await this.completarCategorias(contas);
    await this.marcarOrigemNaFolha(contas);

    return {
      contas: ordenarPorUrgencia(contas),
      resumo: resumirContasAbertas(contas),
      lidoEm: hoje,
      avisos,
    };
  }

  /**
   * O registro do `fn_apagar` como o IXC o devolve, campo por campo.
   *
   * Existe para responder "por que esta conta aparece (ou não) aqui?" sem
   * chute. O nome das colunas do IXC muda entre versões e a documentação não
   * fecha a lista — duas vezes o filtro desta tela errou por isso, e nas duas
   * a resposta estava num campo que ninguém conseguia ver. Agora dá para ver.
   */
  async registroBruto(idFnApagar: number): Promise<DetalheDoTitulo> {
    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      idFnApagar,
    );
    if (!raw) {
      // A listagem trouxe o título, mas perguntando pelo código o IXC não
      // devolve nada. Vale dizer isso por extenso: é a diferença entre "a
      // conta existe e o filtro daqui erra" e "o IXC devolveu na lista algo
      // que ele mesmo não reconhece" — e são consertos completamente
      // diferentes.
      throw new NotFoundException(
        `A lista trouxe o título ${idFnApagar}, mas ao perguntar por ele pelo ` +
          `código o IXC não devolve nada. Ou seja: ele veio na listagem e não ` +
          `existe mais no cadastro — o problema está do lado do IXC, não do ` +
          `filtro desta tela.`,
      );
    }
    return { campos: raw, filtro: explicarFiltro(raw) };
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

  /**
   * Dá nome à conta de despesa de cada título — "terreno", "veículos",
   * "energia" —, que é o eixo do gráfico de com o que a empresa está devendo.
   *
   * O `fn_apagar` costuma trazer só o código. O plano de contas mora numa
   * tabela cujo nome muda de uma versão do IXC para outra e não está fechado na
   * documentação, então os nomes conhecidos são testados um a um, como já se
   * faz com a tabela de dados bancários. Nenhum respondendo, o gráfico agrupa
   * pelo código — menos legível, mas ainda verdadeiro.
   */
  private async completarCategorias(contas: ContaAberta[]): Promise<void> {
    const semNome = contas.filter(
      (c) => !c.categoria.nome && c.categoria.id !== null,
    );
    if (semNome.length === 0) return;

    const nomes = await this.nomesDasContasDeDespesa();
    for (const conta of semNome) {
      conta.categoria.nome = nomes.get(conta.categoria.id!) ?? null;
    }
  }

  private async nomesDasContasDeDespesa(): Promise<Map<number, string>> {
    const agora = Date.now();
    if (
      this.indiceCategorias &&
      agora - this.indiceCategorias.em < VALIDADE_DO_INDICE_MS
    ) {
      return this.indiceCategorias.nomes;
    }

    const nomes = new Map<number, string>();
    for (const tabela of TABELAS_PLANO_DE_CONTAS) {
      try {
        const registros = await this.ixc.listAll<Record<string, unknown>>(
          tabela,
          { qtype: `${tabela}.id`, query: '0', oper: '>' },
          { pageSize: 500, maxPages: 10 },
        );
        for (const raw of registros) {
          const id = Number(raw.id);
          const nome = String(
            raw.descricao ?? raw.nome ?? raw.conta ?? '',
          ).trim();
          if (Number.isInteger(id) && id > 0 && nome) nomes.set(id, nome);
        }
        if (nomes.size > 0) {
          this.logger.log(
            `Plano de contas lido de "${tabela}": ${nomes.size} contas.`,
          );
          break;
        }
      } catch {
        // Tabela que esta base não tem: passa para o próximo nome conhecido.
        continue;
      }
    }

    if (nomes.size === 0) {
      this.logger.warn(
        'Nenhuma tabela de plano de contas respondeu — o gráfico por ' +
          'categoria vai agrupar pelo código da conta.',
      );
    }

    this.indiceCategorias = { em: agora, nomes };
    return nomes;
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
