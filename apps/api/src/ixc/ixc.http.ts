import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import type { AppConfig } from '../config/configuration';

export const IXC_HTTP = 'IXC_HTTP';

/**
 * Cria a instância axios já configurada para o webservice do IXC:
 *  - baseURL https://{host}/webservice/v1
 *  - Basic Auth com o token (formato "id:hash") em base64
 *  - Content-Type JSON e timeout configurável
 *
 * O IXC usa o método GET com corpo JSON nas listagens; o adaptador HTTP do
 * axios (Node) envia o corpo normalmente, então isso funciona.
 */
export function createIxcHttp(ixc: AppConfig['ixc']): AxiosInstance {
  const logger = new Logger('IxcHttp');

  if (!ixc.host || !ixc.token) {
    logger.warn(
      'IXC_HOST/IXC_TOKEN não configurados — chamadas ao IXC vão falhar até preencher o .env',
    );
  }

  const token = Buffer.from(ixc.token || '').toString('base64');

  return axios.create({
    baseURL: `https://${ixc.host}/webservice/v1`,
    timeout: ixc.timeoutMs,
    headers: {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    },
    // O IXC pode devolver 200 com { type: "error" }; deixamos o cliente tratar.
    validateStatus: (s) => s >= 200 && s < 500,
  });
}

export { AxiosInstance };
export { axios };
