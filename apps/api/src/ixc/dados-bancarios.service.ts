import { Injectable, Logger } from '@nestjs/common';
import { IxcClient } from './ixc.client';
import {
  consolidarDadosBancarios,
  detectarCampoFornecedor,
  TABELAS_DADOS_BANCARIOS,
  type DadosBancariosFornecedor,
} from './ixc.fornecedor';

/**
 * Lê a aba "Dados bancários" do fornecedor no IXC — banco, agência, conta e a
 * chave PIX (que o IXC guarda em colunas separadas: PIX CPF/CNPJ, celular e
 * e-mail). É uma tabela à parte, ligada ao fornecedor por `id_fornecedor`.
 *
 * O nome dessa tabela varia entre versões do IXC e não está na documentação
 * pública, então é descoberto na primeira consulta testando os candidatos —
 * e pode ser fixado na configuração financeira se nenhum servir.
 */
@Injectable()
export class DadosBancariosService {
  private readonly logger = new Logger(DadosBancariosService.name);

  /** undefined = ainda não procurou; null = procurou e não achou. */
  private tabela: string | null | undefined;
  private campoFornecedor: string | null | undefined;

  constructor(private readonly ixc: IxcClient) {}

  /** Esquece a tabela descoberta (usado quando a configuração muda). */
  reset(): void {
    this.tabela = undefined;
    this.campoFornecedor = undefined;
  }

  /** Nome da tabela em uso, se já descoberta. */
  get tabelaEmUso(): string | null | undefined {
    return this.tabela;
  }

  /**
   * Dados bancários de um fornecedor. Retorna tudo null quando a tabela não
   * existe ou o fornecedor não tem linha cadastrada — nunca lança, para não
   * derrubar a sincronização inteira por causa de um registro.
   */
  async doFornecedor(
    idFornecedor: number,
    tabelaConfigurada?: string | null,
  ): Promise<DadosBancariosFornecedor> {
    const vazio: DadosBancariosFornecedor = {
      banco: null,
      agencia: null,
      conta: null,
      chavePix: null,
      tipoChavePix: null,
    };

    const tabela = await this.resolverTabela(tabelaConfigurada);
    if (!tabela) return vazio;

    const campo = this.campoFornecedor ?? 'id_fornecedor';
    try {
      const res = await this.ixc.list<Record<string, unknown>>(tabela, {
        qtype: `${tabela}.${campo}`,
        query: String(idFornecedor),
        oper: '=',
        rp: 50,
        sortname: `${tabela}.id`,
        sortorder: 'asc',
      });
      if (res.registros.length === 0) return vazio;
      return consolidarDadosBancarios(res.registros);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Falha ao ler dados bancários do fornecedor #${idFornecedor}: ${message}`,
      );
      return vazio;
    }
  }

  /**
   * Descobre (uma vez por processo) a tabela do grid e o campo que aponta para
   * o fornecedor. Usa a tabela configurada quando informada.
   */
  private async resolverTabela(
    tabelaConfigurada?: string | null,
  ): Promise<string | null> {
    const configurada = (tabelaConfigurada ?? '').trim();
    if (configurada && configurada !== this.tabela) {
      this.tabela = undefined; // configuração mudou: procura de novo
    }
    if (this.tabela !== undefined) return this.tabela;

    const candidatos = configurada
      ? [configurada]
      : [...TABELAS_DADOS_BANCARIOS];

    for (const tabela of candidatos) {
      try {
        const res = await this.ixc.list<Record<string, unknown>>(tabela, {
          qtype: `${tabela}.id`,
          query: '0',
          oper: '>',
          rp: 1,
        });
        this.tabela = tabela;
        this.campoFornecedor = res.registros[0]
          ? detectarCampoFornecedor(res.registros[0])
          : 'id_fornecedor';
        this.logger.log(
          `Dados bancários do fornecedor na tabela "${tabela}" ` +
            `(vínculo: ${this.campoFornecedor ?? 'id_fornecedor'})`,
        );
        return this.tabela;
      } catch {
        // Tabela inexistente nesta base: tenta a próxima.
      }
    }

    this.tabela = null;
    this.logger.warn(
      'Tabela de dados bancários do fornecedor não encontrada. Tentados: ' +
        `${candidatos.join(', ')}. Informe o nome em Configurações se souber.`,
    );
    return null;
  }
}
