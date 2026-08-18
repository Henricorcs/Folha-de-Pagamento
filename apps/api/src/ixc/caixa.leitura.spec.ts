import { CaixaService } from './caixa.service';

/**
 * Ler o caixa do IXC.
 *
 * A tabela é o `fn_movim_finan` — que a documentação chama de "Contabilidade",
 * e é contabilidade mesmo: não há coluna de valor, o dinheiro está em `debito`
 * e `credito`, e a conta é o **razão** do caixa, não o caixa.
 *
 * O que este arquivo protege:
 *
 *  - a consulta vai pelo razão (`contas.id_planejamento`), porque filtrar pelo
 *    id do caixa devolveria lista vazia sem erro nenhum;
 *  - crédito é saída e débito é entrada — caixa é conta de ativo;
 *  - linha sem dinheiro dos dois lados não é movimento e fica de fora;
 *  - a tabela de escrita continua sendo outra: ler não pode ligar a escrita
 *    automática no caixa, que está desligada de propósito.
 */

const CONTA = { id: 7, conta: 'CX - Werick', tipo_conta: 'C', id_planejamento: '12833' };

function montarServico(linhas: Array<Record<string, unknown>>) {
  const consultas: Array<{ recurso: string; params: Record<string, unknown> }> = [];

  const ixc = {
    list: jest.fn(async (recurso: string, params: Record<string, unknown>) => {
      consultas.push({ recurso, params });
      // A sonda que descobre a tabela pede rp:1; o cadastro de contas responde
      // com a conta, e a movimentação com uma linha qualquer.
      if (recurso === 'contas') return { registros: [CONTA], total: 1, page: 1 };
      if (recurso === 'fn_movim_finan') {
        return { registros: linhas.slice(0, Number(params.rp) || 1), total: linhas.length, page: 1 };
      }
      throw new Error(`Recurso ${recurso} não está disponível!`);
    }),
    listAll: jest.fn(async (recurso: string, params: Record<string, unknown>) => {
      consultas.push({ recurso, params });
      return recurso === 'contas' ? [CONTA] : linhas;
    }),
  };

  return { service: new CaixaService(ixc as never), consultas, ixc };
}

const cfg = { caixaTabelaMovimento: '', caixaTabelaContas: '' };
const DE = new Date(2026, 7, 1);
const ATE = new Date(2026, 7, 31);

describe('lendo os lançamentos do caixa', () => {
  it('consulta a movimentação pelo razão do caixa, não pelo id dele', async () => {
    const { service, consultas } = montarServico([
      { id: '1', data: '2026-08-05', debito: '', credito: '250,00', historico: 'Pag. diarista' },
    ]);

    await service.listarLancamentos(7, DE, ATE, cfg);

    const consulta = consultas.find(
      (c) => c.recurso === 'fn_movim_finan' && c.params.oper === '=',
    );
    expect(consulta?.params.qtype).toBe('fn_movim_finan.id_conta');
    // 12833 é o razão da conta 7 — e não "7".
    expect(consulta?.params.query).toBe('12833');
  });

  it('crédito é saída e débito é entrada', async () => {
    const { service } = montarServico([
      { id: '1', data: '2026-08-05', debito: '', credito: '250,00', historico: 'Pagamento' },
      { id: '2', data: '2026-08-06', debito: '1200,00', credito: '', historico: 'Reforço' },
    ]);

    const { lancamentos } = await service.listarLancamentos(7, DE, ATE, cfg);

    expect(lancamentos).toHaveLength(2);
    expect(lancamentos[0]).toMatchObject({ tipo: 'SAIDA', valor: 250 });
    expect(lancamentos[1]).toMatchObject({ tipo: 'ENTRADA', valor: 1200 });
  });

  it('linha sem débito e sem crédito não é movimento de dinheiro', async () => {
    const { service } = montarServico([
      { id: '1', data: '2026-08-05', debito: '0', credito: '0,00', historico: 'Encerramento' },
      { id: '2', data: '2026-08-06', debito: '', credito: '80,00', historico: 'Combustível' },
    ]);

    const { lancamentos } = await service.listarLancamentos(7, DE, ATE, cfg);

    expect(lancamentos.map((l) => l.id)).toEqual([2]);
  });

  it('o que está fora do período fica de fora', async () => {
    const { service } = montarServico([
      { id: '1', data: '2026-07-30', debito: '', credito: '10,00', historico: 'Antes' },
      { id: '2', data: '2026-08-15', debito: '', credito: '20,00', historico: 'Dentro' },
      { id: '3', data: '2026-09-02', debito: '', credito: '30,00', historico: 'Depois' },
    ]);

    const { lancamentos } = await service.listarLancamentos(7, DE, ATE, cfg);

    expect(lancamentos.map((l) => l.historico)).toEqual(['Dentro']);
  });

  it('o último dia entra inteiro', async () => {
    const { service } = montarServico([
      { id: '1', data: '2026-08-31', debito: '', credito: '99,00', historico: 'No fim' },
    ]);

    const { lancamentos } = await service.listarLancamentos(7, DE, ATE, cfg);

    expect(lancamentos).toHaveLength(1);
  });

  it('caixa sem razão no cadastro recusa, em vez de devolver lista vazia', async () => {
    const { service, ixc } = montarServico([]);
    ixc.list.mockImplementation(async (recurso: string) => {
      if (recurso === 'contas') {
        return { registros: [{ ...CONTA, id_planejamento: '' }], total: 1, page: 1 };
      }
      if (recurso === 'fn_movim_finan') return { registros: [], total: 0, page: 1 };
      throw new Error(`Recurso ${recurso} não está disponível!`);
    });
    ixc.listAll.mockResolvedValue([{ ...CONTA, id_planejamento: '' }]);

    await expect(service.listarLancamentos(7, DE, ATE, cfg)).rejects.toThrow(
      /razão/i,
    );
  });

  it('ordena do mais antigo para o mais novo', async () => {
    const { service } = montarServico([
      { id: '3', data: '2026-08-20', debito: '', credito: '3,00', historico: 'c' },
      { id: '1', data: '2026-08-02', debito: '', credito: '1,00', historico: 'a' },
      { id: '2', data: '2026-08-11', debito: '', credito: '2,00', historico: 'b' },
    ]);

    const { lancamentos } = await service.listarLancamentos(7, DE, ATE, cfg);

    expect(lancamentos.map((l) => l.historico)).toEqual(['a', 'b', 'c']);
  });
});
