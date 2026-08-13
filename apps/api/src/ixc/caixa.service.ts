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

/**
 * Quanto tempo um "não achei" continua valendo. Achar vale para sempre — nome
 * de tabela não muda sozinho. Não achar quase nunca é definitivo: o IXC estava
 * fora do ar, a tabela acabou de ganhar o primeiro lançamento, o suporte
 * liberou a permissão agora. Guardar o fracasso pelo resto da vida do processo
 * transformaria o "Lançar no caixa" da tela em enfeite — ele repetiria o mesmo
 * erro sem sequer falar com o IXC. Um minuto absorve a rajada de um pagamento
 * só e já passou quando alguém vai ao IXC e volta.
 */
const FRACASSO_VALE_MS = 60_000;

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
  /** Quando cada "não achei" foi guardado, para saber quando está velho. */
  private naoAchei = { contas: 0, movimento: 0, campos: 0 };
  /** O que o IXC respondeu na última busca que não achou nada. */
  private ultimaFalha: string | null = null;

  constructor(private readonly ixc: IxcClient) {}

  /** Esquece o que foi descoberto (usado quando a configuração muda). */
  reset(): void {
    this.tabelaContas = undefined;
    this.tabelaMovimento = undefined;
    this.campos = undefined;
    this.naoAchei = { contas: 0, movimento: 0, campos: 0 };
    this.ultimaFalha = null;
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
          'até lá, lance a saída na mão.' +
          // Sem isto, "não achei a tabela" engole "não consegui falar com o
          // IXC", e a pessoa liga para o suporte perguntando o nome de uma
          // tabela quando o problema era o host, o token ou a rede.
          (this.ultimaFalha
            ? ` (última resposta do IXC: ${this.ultimaFalha})`
            : ''),
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

    const lembrado = this.lembrado(this.tabelaContas, this.naoAchei.contas);
    if (lembrado !== undefined) return lembrado;

    this.tabelaContas = await this.primeiraQueResponde(
      fixa ? [fixa] : TABELAS_CONTAS_CAIXA,
      'contas/caixas',
    );
    if (this.tabelaContas === null) this.naoAchei.contas = Date.now();
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

    const lembrado = this.lembrado(
      this.tabelaMovimento,
      this.naoAchei.movimento,
    );
    if (lembrado !== undefined) return lembrado;

    this.tabelaMovimento = await this.primeiraQueResponde(
      fixa ? [fixa] : TABELAS_MOVIMENTO_CAIXA,
      'movimentação financeira',
    );
    if (this.tabelaMovimento === null) this.naoAchei.movimento = Date.now();
    return this.tabelaMovimento;
  }

  /**
   * O que está lembrado — ou `undefined`, "vá procurar de novo", quando o que
   * está lembrado é um "não achei" que já passou da validade.
   */
  private lembrado<T>(
    valor: T | null | undefined,
    desde: number,
  ): T | null | undefined {
    if (valor !== null) return valor;
    return Date.now() - desde < FRACASSO_VALE_MS ? null : undefined;
  }

  /** Tabela que respondeu a uma consulta simples (existe nesta base). */
  private async primeiraQueResponde(
    candidatas: string[],
    oQue: string,
  ): Promise<string | null> {
    let ultimoErro: string | null = null;
    for (const tabela of candidatas) {
      try {
        await this.ixc.list<Record<string, unknown>>(tabela, {
          qtype: `${tabela}.id`,
          query: '0',
          oper: '>',
          rp: 1,
        });
        this.logger.log(`Tabela de ${oQue} no IXC: "${tabela}"`);
        this.ultimaFalha = null;
        return tabela;
      } catch (err) {
        // Não existe nesta base — ou o IXC não respondeu. Guarda o motivo: a
        // diferença entre "essa tabela não existe" e "não falei com o IXC" é
        // toda a diferença para quem vai ler o erro na tela, e as duas chegam
        // aqui do mesmo jeito.
        ultimoErro = mensagem(err);
      }
    }
    this.ultimaFalha = ultimoErro;
    this.logger.warn(
      `Tabela de ${oQue} não encontrada. Tentadas: ${candidatas.join(', ')}. ` +
        `Última resposta do IXC: ${ultimoErro ?? '—'}`,
    );
    return null;
  }

  /** Colunas do lançamento, copiadas de um registro que já existe. */
  private async resolverCampos(
    tabela: string,
  ): Promise<CamposMovimento | null> {
    const lembrado = this.lembrado(this.campos, this.naoAchei.campos);
    if (lembrado !== undefined) return lembrado;
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
        this.naoAchei.campos = Date.now();
        this.logger.warn(
          `Não consegui deduzir as colunas do lançamento em "${tabela}"`,
        );
      }
      return this.campos;
    } catch (err) {
      this.logger.warn(`Falha ao ler o modelo de lançamento: ${mensagem(err)}`);
      this.campos = null;
      this.naoAchei.campos = Date.now();
      return null;
    }
  }
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
