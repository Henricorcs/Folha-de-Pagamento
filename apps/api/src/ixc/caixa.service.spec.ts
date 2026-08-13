import { ServiceUnavailableException } from '@nestjs/common';
import { CaixaService } from './caixa.service';
import type { IxcClient } from './ixc.client';

/**
 * A movimentação financeira do IXC é descoberta por tentativa, então tudo aqui
 * gira em torno de *não achar*. O que este arquivo protege:
 *
 *  - "não achei" não vira sentença: o botão "Lançar no caixa" da tela precisa
 *    conseguir tentar de novo depois que o nome da tabela é configurado, que o
 *    IXC volta do ar ou que o primeiro lançamento é feito à mão;
 *  - achar continua valendo para sempre — descobrir custa 8 consultas, e não
 *    dá para pagar isso a cada diária;
 *  - a mensagem que chega na tela diz o que o IXC respondeu, para "não achei a
 *    tabela" não engolir "não consegui falar com o IXC".
 */

const UM_MINUTO = 60_000;

const LANCAMENTO = {
  caixaId: 27,
  valor: 150,
  data: new Date(Date.UTC(2026, 7, 8)),
  historico: 'Diária João — 1 diária de R$ 150,00',
};

const CFG = { caixaTabelaMovimento: '' };

/** Um registro que serve de modelo para copiar os nomes das colunas. */
const MODELO = {
  id: '900',
  id_caixa: '27',
  data: '01/08/2026',
  valor: '150.00',
  historico: 'Suprimento de caixa',
  tipo: 'E',
};

/**
 * Um IXC de mentira: só as tabelas de `base` existem, e uma consulta a
 * qualquer outra falha como o cliente de verdade faz. `base` é mutável de
 * propósito — é assim que o teste simula a tabela que passa a existir.
 */
function fakeIxc(base: Record<string, Record<string, unknown>[]>) {
  const list = jest.fn(async (tabela: string) => {
    const registros = base[tabela];
    if (!registros) {
      throw new ServiceUnavailableException(
        `IXC (${tabela}): tabela não encontrada`,
      );
    }
    return { total: registros.length, page: 1, registros };
  });
  const create = jest.fn(async () => ({ id: 555, raw: {} }));
  const getById = jest.fn(async () => ({
    id: '555',
    id_caixa: '27',
    valor: '150.00',
  }));
  return {
    ixc: { list, create, getById } as unknown as IxcClient,
    list,
    create,
    getById,
  };
}

/** Faz o relógio do serviço andar sem esperar de verdade. */
function avancar(ms: number) {
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + ms);
}

afterEach(() => jest.restoreAllMocks());

describe('CaixaService — descoberta que fracassa', () => {
  it('não repete a busca a cada tentativa dentro do minuto', async () => {
    const { ixc, list } = fakeIxc({});
    const service = new CaixaService(ixc);

    await expect(service.lancarSaida(LANCAMENTO, CFG)).rejects.toThrow(
      /tabela da movimentação financeira/,
    );
    const consultas = list.mock.calls.length;
    expect(consultas).toBeGreaterThan(1); // testou os candidatos

    await expect(service.lancarSaida(LANCAMENTO, CFG)).rejects.toThrow();
    expect(list).toHaveBeenCalledTimes(consultas);
  });

  it('passado o minuto, procura de novo — e acha a tabela que apareceu', async () => {
    const base: Record<string, Record<string, unknown>[]> = {};
    const { ixc, list, create } = fakeIxc(base);
    const service = new CaixaService(ixc);

    await expect(service.lancarSaida(LANCAMENTO, CFG)).rejects.toThrow();
    const consultas = list.mock.calls.length;

    // O suporte do IXC liberou a tabela (ou o IXC voltou do ar).
    base.fn_lancamento_caixa = [MODELO];
    avancar(UM_MINUTO + 1);

    const res = await service.lancarSaida(LANCAMENTO, CFG);
    expect(res).toMatchObject({ tabela: 'fn_lancamento_caixa', id: 555 });
    expect(res.aviso).toBeUndefined();
    expect(list.mock.calls.length).toBeGreaterThan(consultas);
    expect(create).toHaveBeenCalledWith('fn_lancamento_caixa', {
      id_caixa: '27',
      valor: '150.00',
      data: '08/08/2026',
      historico: LANCAMENTO.historico,
      tipo: 'S',
    });
  });

  it('tabela vazia: o primeiro lançamento feito à mão destrava o resto', async () => {
    // A mensagem promete "faça um lançamento na mão e tente de novo" — sem
    // reabrir a busca, essa promessa seria mentira.
    const base: Record<string, Record<string, unknown>[]> = {
      fn_lancamento_caixa: [],
    };
    const { ixc, create } = fakeIxc(base);
    const service = new CaixaService(ixc);

    await expect(service.lancarSaida(LANCAMENTO, CFG)).rejects.toThrow(
      /lançamento existente para eu copiar o formato/,
    );

    base.fn_lancamento_caixa = [MODELO];
    avancar(UM_MINUTO + 1);

    await expect(service.lancarSaida(LANCAMENTO, CFG)).resolves.toMatchObject({
      id: 555,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('conta o que o IXC respondeu, em vez de só "não achei"', async () => {
    const { ixc } = fakeIxc({});
    const service = new CaixaService(ixc);

    await expect(service.lancarSaida(LANCAMENTO, CFG)).rejects.toThrow(
      /última resposta do IXC: IXC \(.+\): tabela não encontrada/,
    );
  });

  it('caixa não encontrado hoje pode ser encontrado depois', async () => {
    const base: Record<string, Record<string, unknown>[]> = {};
    const { ixc } = fakeIxc(base);
    const service = new CaixaService(ixc);
    const cfg = {
      caixaEmMaosId: 0,
      caixaEmMaosNome: 'CX - Werick',
      caixaTabelaContas: '',
    };

    expect(await service.resolverCaixa(cfg)).toBeNull();

    base.fn_contas = [{ id: '27', descricao: 'CX - Werick' }];
    avancar(UM_MINUTO + 1);

    expect(await service.resolverCaixa(cfg)).toBe(27);
  });
});

describe('CaixaService — descoberta que dá certo', () => {
  it('achou uma vez, não procura de novo a cada lançamento', async () => {
    const { ixc, list } = fakeIxc({ fn_lancamento_caixa: [MODELO] });
    const service = new CaixaService(ixc);

    await service.lancarSaida(LANCAMENTO, CFG);
    const consultas = list.mock.calls.length;

    await service.lancarSaida(LANCAMENTO, CFG);
    // Só a releitura de conferência: nada de redescobrir tabela nem colunas.
    expect(list.mock.calls.length).toBe(consultas);
  });

  it('gravou diferente do pedido: avisa em vez de dar por feito', async () => {
    const { ixc, getById } = fakeIxc({ fn_lancamento_caixa: [MODELO] });
    getById.mockResolvedValue({ id: '555', id_caixa: '31', valor: '150.00' });
    const service = new CaixaService(ixc);

    const res = await service.lancarSaida(LANCAMENTO, CFG);
    expect(res.aviso).toMatch(/caixa 31/);
  });
});
