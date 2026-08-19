import { ConciliacaoService } from './conciliacao.service';

/**
 * A montagem da tela de conciliação: o que o IXC devolve virando linha com
 * estado.
 *
 * Três coisas são protegidas aqui, e todas já custaram caro em telas parecidas:
 *
 *  - **o sinal**. Em conta de banco o débito entra e o crédito sai. Trocar isso
 *    faz a tela dizer que entrou dinheiro num dia em que saiu;
 *  - **quem já está conferido**. São três origens — o IXC, esta tela e o
 *    Fechamento de Caixa —, e uma linha conferida em qualquer uma delas não
 *    pode voltar para a fila de "falta conferir";
 *  - **onde se desfaz**. A marca diz de onde veio, porque desfazer no lugar
 *    errado não desfaz nada.
 */

/** Conta 23 (CX - Werick) tem razão 16942. */
const CONTAS = [
  { id: '23', conta: 'CX - Werick', id_planejamento: '16942', tipo_conta: 'C', ativo: 'S' },
  { id: '14', conta: 'Conta Sicoob', id_planejamento: '6531', tipo_conta: 'B', ativo: 'S' },
];

function linha(
  id: number,
  data: string,
  { debito = '0.00', credito = '0.00', historico = 'Pag. Fulano', documento = '' } = {},
) {
  return { id: String(id), data, debito, credito, historico, documento };
}

function montarServico(opts: {
  linhas?: Array<Record<string, unknown>>;
  /** Ids que o IXC devolve como já conciliados por lá. */
  conciliadasNoIxc?: number[];
  /** O que esta tela já conferiu. */
  conferidas?: Array<{ idMovimFinan: number; origem?: 'MANUAL' | 'EXTRATO' }>;
  /** O que o Fechamento de Caixa já conferiu. */
  noFechamento?: number[];
}) {
  const ixc = {
    listAll: jest.fn(async (recurso: string, params: Record<string, unknown>) => {
      if (recurso === 'contas') return CONTAS;
      // A segunda leitura de fn_movim_finan é a que filtra por conciliado='S'.
      const grid = (params.gridParam ?? []) as Array<{ TB: string; P: string }>;
      const soConciliadas = grid.some((g) => g.TB.endsWith('.conciliado'));
      const linhas = opts.linhas ?? [];
      return soConciliadas
        ? linhas.filter((l) => (opts.conciliadasNoIxc ?? []).includes(Number(l.id)))
        : linhas;
    }),
  };

  const prisma = {
    conciliacaoLinha: {
      findMany: jest.fn().mockResolvedValue(
        (opts.conferidas ?? []).map((c) => ({
          idMovimFinan: c.idMovimFinan,
          conferidoEm: new Date('2026-08-18T10:00:00Z'),
          conferidoPor: 'Aurélio',
          origem: c.origem ?? 'MANUAL',
          fitId: null,
        })),
      ),
      upsert: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    conferenciaCaixa: {
      findMany: jest.fn().mockResolvedValue(
        (opts.noFechamento ?? []).map((id) => ({
          idLancamentoIxc: id,
          conferidoEm: new Date('2026-08-17T09:00:00Z'),
          conferidoPor: 'Werick',
        })),
      ),
    },
    contaPagar: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const service = new ConciliacaoService(
    ixc as never,
    prisma as never,
    {} as never,
    {} as never,
  );
  return { service, ixc, prisma };
}

describe('a linha da conciliação', () => {
  it('débito entra e crédito sai — o sinal é o da conta, não o da coluna', async () => {
    const { service } = montarServico({
      linhas: [
        linha(1, '2026-08-03', { credito: '4937.42', historico: 'Pag. MPT' }),
        linha(2, '2026-08-07', { debito: '145.00', historico: 'Rec. Títulos' }),
      ],
    });

    const r = await service.ver({ conta: 23, de: '2026-08-01', ate: '2026-08-31' });

    expect(r.linhas[0].valor).toBe(-4937.42);
    expect(r.linhas[1].valor).toBe(145);
    expect(r.resumo.saidas).toBe(4937.42);
    expect(r.resumo.entradas).toBe(145);
  });

  it('lê do IXC o que o IXC já conciliou', async () => {
    const { service } = montarServico({
      linhas: [linha(1, '2026-08-03', { credito: '10' }), linha(2, '2026-08-04', { credito: '20' })],
      conciliadasNoIxc: [1],
    });

    const r = await service.ver({ conta: 23, de: '2026-08-01', ate: '2026-08-31' });

    expect(r.linhas[0].conciliadoNoIxc).toBe(true);
    expect(r.linhas[1].conciliadoNoIxc).toBe(false);
    expect(r.resumo.fechadas).toBe(1);
    expect(r.resumo.pendentes).toBe(1);
  });

  it('conferida no Fechamento de Caixa não volta para a fila daqui', async () => {
    const { service } = montarServico({
      linhas: [linha(1, '2026-08-03', { credito: '10' }), linha(2, '2026-08-04', { credito: '20' })],
      noFechamento: [1],
    });

    const r = await service.ver({ conta: 23, de: '2026-08-01', ate: '2026-08-31' });

    expect(r.linhas[0].conferida).toMatchObject({
      onde: 'fechamento-caixa',
      por: 'Werick',
    });
    expect(r.resumo.pendentes).toBe(1);
  });

  it('a marca desta tela vence a da outra: é aqui que ela se desfaz', async () => {
    const { service } = montarServico({
      linhas: [linha(1, '2026-08-03', { credito: '10' })],
      conferidas: [{ idMovimFinan: 1, origem: 'EXTRATO' }],
      noFechamento: [1],
    });

    const r = await service.ver({ conta: 23, de: '2026-08-01', ate: '2026-08-31' });

    expect(r.linhas[0].conferida).toMatchObject({
      onde: 'conciliacao',
      origem: 'EXTRATO',
      por: 'Aurélio',
    });
  });

  it('pergunta ao Fechamento de Caixa pela conta escolhida, e só lê', async () => {
    const { service, prisma } = montarServico({
      linhas: [linha(1, '2026-08-03', { credito: '10' })],
    });

    await service.ver({ conta: 23, de: '2026-08-01', ate: '2026-08-31' });

    const [{ where }] = prisma.conferenciaCaixa.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(where).toMatchObject({ caixaId: 23, conferido: true });
    // A tabela de lá guarda a foto da nota: daqui não se escreve nem se apaga.
    expect(Object.keys(prisma.conferenciaCaixa)).toEqual(['findMany']);
  });

  it('acha o título no histórico da baixa, e só do lado de pagar', async () => {
    const { service } = montarServico({
      linhas: [
        linha(1, '2026-08-13', {
          credito: '756.57',
          historico: 'Pag. Comercial Rofe Ltda - doc.: 36508',
        }),
        linha(2, '2026-08-14', { debito: '82.91', historico: 'Rec. Títulos 769465 Fulano' }),
      ],
    });

    const r = await service.ver({ conta: 23, de: '2026-08-01', ate: '2026-08-31' });

    expect(r.linhas[0].titulo?.idFnApagar).toBe(36508);
    expect(r.linhas[1].titulo).toBeNull();
  });

  it('cruza com o extrato: o que bateu, o que sobrou de cada lado', async () => {
    const { service } = montarServico({
      linhas: [
        linha(1, '2026-08-13', { credito: '756.57' }),
        linha(2, '2026-08-14', { credito: '100.00' }),
      ],
    });

    const r = await service.ver({
      conta: 23,
      de: '2026-08-01',
      ate: '2026-08-31',
      ofx: `<OFX><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260813<TRNAMT>-756.57<FITID>a<MEMO>PIX</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260815<TRNAMT>-42.00<FITID>b<MEMO>TARIFA</STMTTRN>
</BANKTRANLIST></OFX>`,
    });

    expect(r.linhas[0].extrato).toMatchObject({ fitId: 'a', como: 'exato' });
    // Lançada no IXC e sem par no extrato: continua sem extrato.
    expect(r.linhas[1].extrato).toBeNull();
    // No banco e não no IXC: é o achado que a tela existe para mostrar.
    expect(r.extrato?.soNoBanco.map((t) => t.fitId)).toEqual(['b']);
    expect(r.extrato?.saidas).toBe(798.57);
  });

  it('transação do extrato fora do período não vira problema inventado', async () => {
    const { service } = montarServico({
      linhas: [linha(1, '2026-08-13', { credito: '756.57' })],
    });

    const r = await service.ver({
      conta: 23,
      de: '2026-08-01',
      ate: '2026-08-15',
      ofx: `<OFX><BANKTRANLIST>
<STMTTRN><DTPOSTED>20260813<TRNAMT>-756.57<FITID>a<MEMO>PIX</STMTTRN>
<STMTTRN><DTPOSTED>20260828<TRNAMT>-42.00<FITID>fora<MEMO>TARIFA</STMTTRN>
</BANKTRANLIST></OFX>`,
    });

    expect(r.extrato?.soNoBanco).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/fora de 01\/08\/2026 a 15\/08\/2026/);
  });

  it('recusa arquivo que não é extrato em vez de dizer que o banco não moveu nada', async () => {
    const { service } = montarServico({ linhas: [linha(1, '2026-08-13', { credito: '10' })] });

    await expect(
      service.ver({
        conta: 23,
        de: '2026-08-01',
        ate: '2026-08-31',
        ofx: 'data;valor\n13/08/2026;-756,57',
      }),
    ).rejects.toThrow(/não é um OFX/i);
  });

  it('recusa conta que não existe, e diz por quê', async () => {
    const { service } = montarServico({});

    await expect(
      service.ver({ conta: 999, de: '2026-08-01', ate: '2026-08-31' }),
    ).rejects.toThrow(/não existe no IXC/i);
  });

  it('recusa período de trás para frente e período longo demais', async () => {
    const { service } = montarServico({});

    await expect(
      service.ver({ conta: 23, de: '2026-08-31', ate: '2026-08-01' }),
    ).rejects.toThrow(/começa depois de terminar/i);
    await expect(
      service.ver({ conta: 23, de: '2024-01-01', ate: '2026-08-01' }),
    ).rejects.toThrow(/não pode passar de um ano/i);
  });
});
