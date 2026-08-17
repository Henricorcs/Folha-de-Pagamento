import { ServiceUnavailableException } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import { IxcClient, motivoDaRecusa } from './ixc.client';

function makeHttp(requestImpl: jest.Mock): AxiosInstance {
  return { request: requestImpl } as unknown as AxiosInstance;
}

describe('IxcClient.list', () => {
  it('monta o body de listagem e envia header ixcsoft', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: { total: '2', registros: [{ id: '1' }, { id: '2' }] },
    });
    const client = new IxcClient(makeHttp(request));

    const res = await client.list('funcionarios', {
      qtype: 'funcionarios.id',
      query: '1',
      oper: '>=',
    });

    expect(res.total).toBe(2);
    expect(res.registros).toHaveLength(2);

    const call = request.mock.calls[0][0];
    expect(call.method).toBe('GET');
    expect(call.url).toBe('/funcionarios');
    expect(call.headers.ixcsoft).toBe('listar');
    expect(call.data).toMatchObject({
      qtype: 'funcionarios.id',
      query: '1',
      oper: '>=',
      page: '1',
    });
  });

  it('trata erro lógico do IXC (type=error) como 503', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: { type: 'error', message: 'token inválido' },
    });
    const client = new IxcClient(makeHttp(request));

    await expect(
      client.list('funcionarios', { qtype: 'funcionarios.id', query: '1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('converte falha de rede em ServiceUnavailable', async () => {
    const request = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new IxcClient(makeHttp(request));

    await expect(
      client.list('funcionarios', { qtype: 'funcionarios.id', query: '1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('IxcClient.listAll', () => {
  it('pagina até coletar todos os registros', async () => {
    const request = jest
      .fn()
      // página 1 cheia (2 de 3)
      .mockResolvedValueOnce({
        status: 200,
        data: { total: '3', registros: [{ id: '1' }, { id: '2' }] },
      })
      // página 2 com o restante
      .mockResolvedValueOnce({
        status: 200,
        data: { total: '3', registros: [{ id: '3' }] },
      });
    const client = new IxcClient(makeHttp(request));

    const all = await client.listAll(
      'funcionarios',
      { qtype: 'funcionarios.id', query: '1', oper: '>=' },
      { pageSize: 2 },
    );

    expect(all.map((r: any) => r.id)).toEqual(['1', '2', '3']);
    expect(request).toHaveBeenCalledTimes(2);
  });
});

/**
 * O IXC recusa de dois jeitos: pelo status HTTP e por `type: "error"` com HTTP
 * 200. No segundo, ele nem sempre manda `message` — e a mensagem antiga saía
 * literalmente "HTTP 200", um código de sucesso apresentado como falha. Quem
 * lia isso na tela não tinha o que fazer com a informação, e quem fosse
 * investigar também não.
 */
describe('motivoDaRecusa', () => {
  it('usa a mensagem do IXC quando ela existe', () => {
    expect(
      motivoDaRecusa(200, { type: 'error', message: 'Conta já baixada' }),
    ).toBe('Conta já baixada');
  });

  it('sem mensagem, diz que não houve motivo e mostra o que veio', () => {
    const m = motivoDaRecusa(200, { type: 'error' });

    expect(m).toContain('recusou sem dizer o motivo');
    expect(m).toContain('HTTP 200');
    expect(m).toContain('{"type":"error"}');
  });

  it('corpo vazio não vira ruído na mensagem', () => {
    expect(motivoDaRecusa(500, {})).toBe(
      'recusou sem dizer o motivo (HTTP 500)',
    );
  });

  /** Resposta em HTML (o IXC faz isso quando quebra de verdade) não pode
      empurrar uma página inteira para dentro do aviso da tela. */
  it('corta corpo comprido', () => {
    const m = motivoDaRecusa(200, '<html>' + 'x'.repeat(1000) + '</html>');

    expect(m.length).toBeLessThan(360);
  });

  it('mensagem só de espaços conta como ausente', () => {
    expect(motivoDaRecusa(200, { type: 'error', message: '   ' })).toContain(
      'recusou sem dizer o motivo',
    );
  });
});
