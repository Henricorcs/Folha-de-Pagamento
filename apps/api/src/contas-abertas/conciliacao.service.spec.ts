import { ConciliacaoService } from './conciliacao.service';

/**
 * Consertar um pagamento antigo é estornar a baixa e refazê-la. Entre as duas
 * coisas o título fica **em aberto** no IXC — e título em aberto é título que
 * alguém paga de novo.
 *
 * O que este arquivo protege:
 *
 *  - só se mexe no que está pago e realmente torto (o resto é pulado intacto);
 *  - a nova baixa vai na conta do razão, que é o que faltava;
 *  - falhando a segunda metade, a fila **para** e o título aparece na lista de
 *    "em aberto" — nunca some no meio de um relatório de sucesso.
 */

/** Conta 18 (ModoBank) tem razão 12833; a 23 (caixa), 16942. */
const CONTAS = [
  { id: '18', conta: 'Conta ModoBank PIX', id_planejamento: '12833' },
  { id: '23', conta: 'CX - Werick', id_planejamento: '16942' },
];

function montarServico(
  opts: {
    /** Onde a perna M está hoje. Igual ao razão = já está certo. */
    contaDaPernaM?: string;
    /** O título já não consta pago no IXC. */
    naoEstaPago?: boolean;
    /** O estorno passa, mas o título continua pago. */
    estornoNaoPega?: boolean;
    /** A nova baixa não quita o título — é o caso perigoso. */
    baixaNaoQuita?: boolean;
    /** Contas a pagar do banco local que o app criou e deu por pagas. */
    nossas?: Array<{ idFnApagarIxc: number; beneficiarioNome: string }>;
  } = {},
) {
  const chamadas: string[] = [];
  // O IXC de mentira acompanha o título: pago → estornado (em aberto) → pago.
  let estornou = false;
  let baixouDeNovo = false;

  const ixc = {
    listAll: jest.fn(async () => CONTAS),
    list: jest.fn(async () => ({
      registros: [
        {
          id: '900',
          id_movim_finan: '899',
          id_conta: opts.contaDaPernaM ?? '324',
          tipo_lanc: 'M',
          data: '2026-08-08',
          credito: '167.00',
          debito: '0.00',
          documento: '37020',
          historico: 'Pag. Gilvan Pereira da Costa - doc.: 37020',
        },
        { id: '901', id_movim_finan: '899', id_conta: '324', tipo_lanc: 'P' },
      ],
      total: 2,
      page: 1,
    })),
    getById: jest.fn(async () => {
      const pago = opts.naoEstaPago
        ? false
        : !estornou ||
          !!opts.estornoNaoPega ||
          (baixouDeNovo && !opts.baixaNaoQuita);
      return {
        id: '37020',
        status: pago ? 'P' : 'A',
        valor: '167.00',
        valor_aberto: pago ? '0' : '167.00',
        valor_total_pago: pago ? '167.00' : '0',
        id_contas: '18',
        id_conta: '324',
        filial_id: '1',
        tipo_pagamento: 'Pix',
      };
    }),
    remove: jest.fn(async () => {
      chamadas.push('estorno');
      estornou = true;
      return {};
    }),
    action: jest.fn(async (endpoint: string, payload: Record<string, unknown>) => {
      chamadas.push(`baixa:${payload.id_conta}`);
      baixouDeNovo = true;
      return {};
    }),
  };

  const prisma = {
    contaPagar: {
      findMany: jest.fn(async () =>
        opts.nossas ?? [{ idFnApagarIxc: 37020, beneficiarioNome: 'Gilvan' }],
      ),
    },
  };

  return {
    service: new ConciliacaoService(ixc as never, prisma as never),
    ixc,
    chamadas,
  };
}

describe('ConciliacaoService.pendentes', () => {
  it('acha o pagamento cuja perna M ficou fora do razão da conta', async () => {
    const { service } = montarServico();
    const [p] = await service.pendentes();

    expect(p).toMatchObject({
      idFnApagar: 37020,
      beneficiario: 'Gilvan',
      contaPagamento: 18,
      contaAtual: 324,
      contaCerta: 12833,
      idMovimFinan: 899,
      valor: 167,
      data: '2026-08-08',
    });
  });

  it('o que já está no razão certo não entra na lista', async () => {
    const { service } = montarServico({ contaDaPernaM: '12833' });
    expect(await service.pendentes()).toEqual([]);
  });

  it('título que não consta pago no IXC fica de fora', async () => {
    const { service } = montarServico({ naoEstaPago: true });
    expect(await service.pendentes()).toEqual([]);
  });

  it('só olha o que este app criou', async () => {
    const { service, ixc } = montarServico({ nossas: [] });
    expect(await service.pendentes()).toEqual([]);
    // Nem chega a perguntar ao IXC: sem título nosso não há o que conferir.
    expect(ixc.getById).not.toHaveBeenCalled();
  });
});

describe('ConciliacaoService.corrigir', () => {
  it('estorna e refaz a baixa na conta do razão', async () => {
    const { service, chamadas } = montarServico();
    const r = await service.corrigir([37020]);

    expect(chamadas).toEqual(['estorno', 'baixa:12833']);
    expect(r.corrigidos).toEqual([37020]);
    expect(r.emAberto).toEqual([]);
  });

  it('o que já está certo é pulado sem ser tocado', async () => {
    const { service, chamadas } = montarServico({ contaDaPernaM: '12833' });
    const r = await service.corrigir([37020]);

    expect(chamadas).toEqual([]);
    expect(r.corrigidos).toEqual([]);
    expect(r.pulados).toHaveLength(1);
  });

  it('estorno que não pega não vira baixa nova: nada é feito duas vezes', async () => {
    const { service, chamadas } = montarServico({ estornoNaoPega: true });
    const r = await service.corrigir([37020]);

    // Estornou (ou tentou), mas o título seguiu pago — a baixa antiga está lá.
    expect(chamadas).toEqual(['estorno']);
    expect(r.corrigidos).toEqual([]);
    expect(r.emAberto).toHaveLength(1);
  });

  it('baixa que não quita deixa o título em aberto — e a fila para ali', async () => {
    const { service } = montarServico({ baixaNaoQuita: true });
    const r = await service.corrigir([37020, 37021, 37022]);

    expect(r.corrigidos).toEqual([]);
    expect(r.emAberto).toEqual([
      {
        idFnApagar: 37020,
        erro: expect.stringContaining('em aberto') as unknown as string,
      },
    ]);
    // Os seguintes nem foram tentados: um título aberto é assunto para agora.
    expect(r.naoTentados).toEqual([37021, 37022]);
  });

  it('sem nenhum id, recusa em vez de rodar em cima de nada', async () => {
    const { service } = montarServico();
    await expect(service.corrigir([])).rejects.toThrow();
  });
});
