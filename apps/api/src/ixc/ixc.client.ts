import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import { IXC_HTTP } from './ixc.http';
import type {
  IxcActionResponse,
  IxcListParams,
  IxcListResponse,
} from './ixc.types';

/**
 * Cliente de alto nível para o webservice do IXC.
 * Encapsula o protocolo (header ixcsoft, paginação, tratamento de erro) e
 * expõe operações tipadas. Recebe a AxiosInstance por injeção para permitir
 * testes unitários sem rede.
 */
@Injectable()
export class IxcClient {
  private readonly logger = new Logger(IxcClient.name);

  constructor(@Inject(IXC_HTTP) private readonly http: AxiosInstance) {}

  /** Uma página de resultados. */
  async list<T = Record<string, unknown>>(
    resource: string,
    params: IxcListParams,
  ): Promise<IxcListResponse<T>> {
    const body: Record<string, unknown> = {
      qtype: params.qtype,
      query: params.query,
      oper: params.oper ?? '=',
      page: String(params.page ?? 1),
      rp: String(params.rp ?? 100),
      sortname: params.sortname ?? params.qtype,
      sortorder: params.sortorder ?? 'asc',
    };
    if (params.gridParam !== undefined) {
      body.grid_param = JSON.stringify(params.gridParam);
    }

    let res;
    try {
      res = await this.http.request({
        url: `/${resource}`,
        method: 'GET',
        headers: { ixcsoft: 'listar' },
        data: body,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha de rede ao consultar ${resource}: ${message}`);
      throw new ServiceUnavailableException(
        `Não foi possível contatar o IXC (${resource}): ${message}`,
      );
    }

    const data = res.data as
      | { total?: string | number; registros?: T[]; type?: string; message?: string }
      | undefined;

    if (res.status >= 400 || (data && data.type === 'error')) {
      const msg = (data && data.message) || `HTTP ${res.status}`;
      this.logger.error(`IXC retornou erro em ${resource}: ${msg}`);
      throw new ServiceUnavailableException(`IXC (${resource}): ${msg}`);
    }

    return {
      total: Number(data?.total ?? 0),
      page: params.page ?? 1,
      registros: (data?.registros ?? []) as T[],
    };
  }

  /** Busca um único registro por id (usa a listagem com filtro por id). */
  async getById<T = Record<string, unknown>>(
    resource: string,
    idField: string,
    id: number | string,
  ): Promise<T | null> {
    const res = await this.list<T>(resource, {
      qtype: idField,
      query: String(id),
      oper: '=',
      rp: 1,
    });
    return res.registros[0] ?? null;
  }

  /**
   * Insere um registro (POST). Retorna o id criado e o payload cru.
   * Não envia o header `ixcsoft` (usado apenas em listagens).
   */
  async create(
    resource: string,
    body: Record<string, unknown>,
  ): Promise<{ id: number | null; raw: IxcActionResponse }> {
    const data = await this.write('post', `/${resource}`, body);
    return { id: extrairId(data), raw: data };
  }

  /** Edita um registro (PUT /resource/id). */
  async update(
    resource: string,
    id: number | string,
    body: Record<string, unknown>,
  ): Promise<IxcActionResponse> {
    return this.write('put', `/${resource}/${id}`, body);
  }

  /** Apaga um registro (DELETE /resource/id). */
  async remove(
    resource: string,
    id: number | string,
  ): Promise<IxcActionResponse> {
    return this.write('delete', `/${resource}/${id}`);
  }

  /**
   * Chama um endpoint de ação/botão (ex.: fn_apagar_auditoria) via POST.
   * Esses endpoints não seguem o padrão CRUD e retornam formatos variados.
   */
  async action(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<IxcActionResponse> {
    return this.write('post', `/${endpoint}`, body);
  }

  private async write(
    method: 'post' | 'put' | 'delete',
    url: string,
    body?: Record<string, unknown>,
  ): Promise<IxcActionResponse> {
    let res;
    try {
      res = await this.http.request({ url, method, data: body });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha de rede em ${method.toUpperCase()} ${url}: ${message}`);
      throw new ServiceUnavailableException(
        `Não foi possível contatar o IXC (${url}): ${message}`,
      );
    }

    const data = (res.data ?? {}) as IxcActionResponse;
    const tipo = String(data.type ?? '').toLowerCase();
    if (res.status >= 400 || tipo === 'error') {
      const msg = motivoDaRecusa(res.status, res.data);
      this.logger.error(`IXC erro em ${method.toUpperCase()} ${url}: ${msg}`);
      throw new ServiceUnavailableException(`IXC (${url}): ${msg}`);
    }
    return data;
  }

  /**
   * Percorre todas as páginas e devolve todos os registros.
   * `maxPages` protege contra loops caso `total` venha inconsistente.
   */
  async listAll<T = Record<string, unknown>>(
    resource: string,
    params: Omit<IxcListParams, 'page'>,
    opts: { pageSize?: number; maxPages?: number } = {},
  ): Promise<T[]> {
    const pageSize = opts.pageSize ?? 500;
    const maxPages = opts.maxPages ?? 1000;

    const out: T[] = [];
    let page = 1;
    let total = Infinity;

    while (out.length < total && page <= maxPages) {
      const res = await this.list<T>(resource, {
        ...params,
        page,
        rp: pageSize,
      });
      total = res.total;
      if (res.registros.length === 0) break;
      out.push(...res.registros);
      if (res.registros.length < pageSize) break;
      page += 1;
    }

    return out;
  }
}

/**
 * Por que o IXC recusou, dito de um jeito que dê para agir.
 *
 * Ele nem sempre manda `message`, e nem sempre usa o status HTTP para dizer que
 * deu errado — recusa com `type: "error"` e HTTP 200 acontece. A mensagem
 * antiga, nesse caso, saía literalmente "HTTP 200": um código de sucesso
 * apresentado como falha, que não diz nada a quem lê e menos ainda a quem vai
 * investigar.
 *
 * Sem `message`, o corpo cru vai junto (recortado): é a única pista que existe
 * de por que ele recusou, e ela precisa chegar ao log e à tela.
 */
export function motivoDaRecusa(status: number, corpo: unknown): string {
  const data = (corpo ?? {}) as IxcActionResponse;

  /*
   * `message` é onde a documentação diz que o motivo vai, e é onde ele às vezes
   * está. Nas baixas de conta a pagar ele vem em `valor`:
   *
   *   {"type":"error","valor":"Erro inesperado, tente novamente!"}
   *
   * Lendo só `message`, o motivo existia e era descartado — a tela dizia "HTTP
   * 200" para uma resposta que trazia a explicação escrita. As duas são
   * tentadas, na ordem, e `mensagem` entra porque o webservice mistura inglês
   * e português conforme o endpoint.
   */
  for (const campo of ['message', 'valor', 'mensagem'] as const) {
    const texto = String(data[campo] ?? '').trim();
    if (texto) return texto;
  }

  let cru: string;
  try {
    cru = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  } catch {
    cru = String(corpo);
  }
  cru = (cru ?? '').trim().slice(0, 300);

  return (
    `recusou sem dizer o motivo (HTTP ${status}` +
    (cru && cru !== '{}' ? `, resposta: ${cru}` : '') +
    ')'
  );
}

/** Extrai o id retornado por um insert do IXC, em qualquer formato comum. */
function extrairId(data: IxcActionResponse): number | null {
  const candidato = data.id ?? (data as Record<string, unknown>).ret ?? null;
  const n = Number(candidato);
  return Number.isInteger(n) && n > 0 ? n : null;
}
