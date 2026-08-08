import { Injectable, Logger } from '@nestjs/common';
import { IxcClient } from './ixc.client';
import {
  acharCaixaPorNome,
  buildLancamentoSaida,
  conferirLancamento,
  detectarCamposMovimento,
  mapCaixa,
  TABELAS_CONTAS_CAIXA,
  TABELAS_MOVIMENTO_CAIXA,
  type CaixaIxc,
  type CamposMovimento,
  type LancamentoCaixaInput,
} from './ixc.caixa';

/** Onde o dinheiro em mãos saiu — ou por que não deu para lançar. */
export interface ResultadoLancamentoCaixa {
  /** Tabela do IXC que recebeu o lançamento. */
  tabela: string;
  /** Id do lançamento criado. */
  id: number;
  /** Preenchido quando gravou mas algo não conferiu: peça para olhar no IXC. */
  aviso?: string;
}

/**
 * O caixa do IXC (Financeiro > Movimentação > Financeira). Serve para duas
 * coisas: listar os caixas — para a configuração achar o "CX - Werick" — e
 * lançar a saída do dinheiro pago em mãos.
 *
 * Nenhum dos dois nomes de tabela está na documentação pública do webservice,
 * então são descobertos por consulta (que não altera nada) e podem ser fixados
 * na configuração. E o lançamento só é escrito quando existe um registro real
 * naquela tabela para copiar os nomes das colunas: sem modelo, o app recusa
 * escrever e manda a diária para "lançar no IXC à mão". Ver [[project]].
 */
@Injectable()
export class CaixaService {
  private readonly logger = new Logger(CaixaService.name);

  /** undefined = ainda não procurou; null = procurou e não achou. */
  private tabelaContas: string | null | undefined;
  private tabelaMovimento: string | null | undefined;
  private campos: CamposMovimento | null | undefined;

  constructor(private readonly ixc: IxcClient) {}

  /** Esquece o que foi descoberto (usado quando a configuração muda). */
  reset(): void {
    this.tabelaContas = undefined;
    this.tabelaMovimento = undefined;
    this.campos = undefined;
  }

  /** Nomes de tabela em uso, para a tela de configuração mostrar. */
  get tabelasEmUso(): { contas: string | null; movimento: string | null } {
    return {
      contas: this.tabelaContas ?? null,
      movimento: this.tabelaMovimento ?? null,
    };
  }

  /**
   * Os caixas/contas cadastrados no IXC. É consulta pura: serve para conferir
   * o código do "CX - Werick" sem ninguém precisar caçar na tela do IXC.
   */
  async listarCaixas(
    tabelaConfigurada?: string | null,
  ): Promise<{ tabela: string | null; caixas: CaixaIxc[] }> {
    const tabela = await this.resolverTabelaContas(tabelaConfigurada);
    if (!tabela) return { tabela: null, caixas: [] };

    try {
      const res = await this.ixc.list<Record<string, unknown>>(tabela, {
        qtype: `${tabela}.id`,
        query: '0',
        oper: '>',
        rp: 500,
        sortname: `${tabela}.id`,
        sortorder: 'asc',
      });
      const caixas = res.registros
        .map(mapCaixa)
        .filter((c): c is CaixaIxc => c !== null);
      return { tabela, caixas };
    } catch (err) {
      this.logger.warn(`Falha ao listar os caixas do IXC: ${mensagem(err)}`);
      return { tabela, caixas: [] };
    }
  }

  /**
   * Código do caixa a usar no pagamento em mãos: o configurado vence; sem ele,
   * procura pelo nome. Retorna null quando não achou — o pagamento continua
   * registrado aqui, só sem a saída no IXC.
   */
  async resolverCaixa(cfg: {
    caixaEmMaosId: number;
    caixaEmMaosNome: string;
    caixaTabelaContas: string;
  }): Promise<number | null> {
    if (cfg.caixaEmMaosId > 0) return cfg.caixaEmMaosId;

    const { caixas } = await this.listarCaixas(cfg.caixaTabelaContas);
    const achado = acharCaixaPorNome(caixas, cfg.caixaEmMaosNome);
    if (achado) {
      this.logger.log(
        `Caixa "${cfg.caixaEmMaosNome}" encontrado no IXC: #${achado.id} (${achado.nome})`,
      );
      return achado.id;
    }
    this.logger.warn(
      `Caixa "${cfg.caixaEmMaosNome}" não encontrado entre ${caixas.length} conta(s) ` +
        'do IXC. Informe o código em Configurações.',
    );
    return null;
  }

  /**
   * Lança a saída do dinheiro no caixa. Lança exceção com um texto que dá para
   * mostrar na tela quando não foi possível — quem chama guarda isso na diária
   * para a pessoa poder tentar de novo ou lançar na mão.
   */
  async lancarSaida(
    input: LancamentoCaixaInput,
    cfg: { caixaTabelaMovimento: string },
  ): Promise<ResultadoLancamentoCaixa> {
    const tabela = await this.resolverTabelaMovimento(cfg.caixaTabelaMovimento);
    if (!tabela) {
      throw new Error(
        'Não encontrei a tabela da movimentação financeira no seu IXC. ' +
          'Peça o nome dela ao suporte do IXC e informe em Configurações — ' +
          'até lá, lance a saída na mão.',
      );
    }

    const campos = await this.resolverCampos(tabela);
    if (!campos) {
      throw new Error(
        `A tabela "${tabela}" não tem um lançamento existente para eu copiar o ` +
          'formato (caixa, valor, data e histórico). Faça um lançamento na mão ' +
          'no IXC e tente de novo — a partir do segundo eu consigo sozinho.',
      );
    }

    const body = buildLancamentoSaida(campos, input);
    const { id } = await this.ixc.create(tabela, body);
    if (!id) {
      throw new Error(`O IXC não devolveu o id do lançamento em "${tabela}"`);
    }

    // Escrever em tabela descoberta por tentativa pede conferência: relê o
    // registro e compara com o que se pediu.
    const gravado = await this.ixc
      .getById<Record<string, unknown>>(tabela, `${tabela}.id`, id)
      .catch(() => null);
    const conferido = conferirLancamento(gravado, campos, input);

    this.logger.log(
      `Saída de ${input.valor} lançada no caixa #${input.caixaId} ` +
        `(${tabela} #${id})${conferido.ok ? '' : ' — com aviso'}`,
    );
    return {
      tabela,
      id,
      aviso: conferido.ok
        ? undefined
        : `Lançamento ${id} criado, mas ${conferido.motivo}. Confira no IXC.`,
    };
  }

  // -------------------------------------------------------------------------
  // Descoberta dos nomes (uma vez por processo)
  // -------------------------------------------------------------------------
  private async resolverTabelaContas(
    configurada?: string | null,
  ): Promise<string | null> {
    const fixa = (configurada ?? '').trim();
    if (fixa && fixa !== this.tabelaContas) this.tabelaContas = undefined;
    if (this.tabelaContas !== undefined) return this.tabelaContas;

    this.tabelaContas = await this.primeiraQueResponde(
      fixa ? [fixa] : TABELAS_CONTAS_CAIXA,
      'contas/caixas',
    );
    return this.tabelaContas;
  }

  private async resolverTabelaMovimento(
    configurada?: string | null,
  ): Promise<string | null> {
    const fixa = (configurada ?? '').trim();
    if (fixa && fixa !== this.tabelaMovimento) {
      this.tabelaMovimento = undefined;
      this.campos = undefined;
    }
    if (this.tabelaMovimento !== undefined) return this.tabelaMovimento;

    this.tabelaMovimento = await this.primeiraQueResponde(
      fixa ? [fixa] : TABELAS_MOVIMENTO_CAIXA,
      'movimentação financeira',
    );
    return this.tabelaMovimento;
  }

  /** Tabela que respondeu a uma consulta simples (existe nesta base). */
  private async primeiraQueResponde(
    candidatas: string[],
    oQue: string,
  ): Promise<string | null> {
    for (const tabela of candidatas) {
      try {
        await this.ixc.list<Record<string, unknown>>(tabela, {
          qtype: `${tabela}.id`,
          query: '0',
          oper: '>',
          rp: 1,
        });
        this.logger.log(`Tabela de ${oQue} no IXC: "${tabela}"`);
        return tabela;
      } catch {
        // Não existe nesta base: tenta a próxima.
      }
    }
    this.logger.warn(
      `Tabela de ${oQue} não encontrada. Tentadas: ${candidatas.join(', ')}.`,
    );
    return null;
  }

  /** Colunas do lançamento, copiadas de um registro que já existe. */
  private async resolverCampos(
    tabela: string,
  ): Promise<CamposMovimento | null> {
    if (this.campos !== undefined) return this.campos;
    try {
      const res = await this.ixc.list<Record<string, unknown>>(tabela, {
        qtype: `${tabela}.id`,
        query: '0',
        oper: '>',
        rp: 1,
        sortname: `${tabela}.id`,
        sortorder: 'desc',
      });
      const modelo = res.registros[0];
      this.campos = modelo ? detectarCamposMovimento(modelo) : null;
      if (this.campos) {
        this.logger.log(
          `Lançamento no caixa usará as colunas ${JSON.stringify(this.campos)}`,
        );
      } else {
        this.logger.warn(
          `Não consegui deduzir as colunas do lançamento em "${tabela}"`,
        );
      }
      return this.campos;
    } catch (err) {
      this.logger.warn(`Falha ao ler o modelo de lançamento: ${mensagem(err)}`);
      this.campos = null;
      return null;
    }
  }
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
