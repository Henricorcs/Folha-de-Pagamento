import { casar, type LinhaParaCasar } from './conciliacao.casar';
import type { TransacaoExtrato } from './conciliacao.ofx';

/**
 * O casamento é onde a conciliação ganha ou perde a confiança de quem a usa.
 *
 * O erro caro não é deixar de casar — isso aparece na tela como "só no banco" e
 * alguém resolve. O erro caro é casar **errado**: dar por conferida uma saída
 * que não é aquela, e com isso esconder um pagamento que faltou lançar. Por
 * isso quase todo teste aqui é sobre valor repetido, que é onde a confusão
 * mora.
 */

function linha(
  id: number,
  data: string,
  valor: number,
  historico = 'Pag. Fulano',
  documento: string | null = null,
): LinhaParaCasar {
  return { id, data, valor, historico, documento };
}

function transacao(
  fitId: string,
  data: string,
  valor: number,
  extra: Partial<TransacaoExtrato> = {},
): TransacaoExtrato {
  return {
    fitId,
    data,
    valor,
    descricao: 'PAGAMENTO',
    documento: null,
    tipo: null,
    ...extra,
  };
}

describe('casar', () => {
  it('casa pelo valor e pela data, e não sobra nada', () => {
    const r = casar(
      [linha(1, '2026-08-13', -756.57), linha(2, '2026-08-14', 82.91)],
      [transacao('a', '2026-08-13', -756.57), transacao('b', '2026-08-14', 82.91)],
    );

    expect(r.casados).toHaveLength(2);
    expect(r.soNoBanco).toHaveLength(0);
    expect(r.soNoIxc).toHaveLength(0);
    expect(r.casados[0].como).toBe('exato');
    expect(r.casados[0].diasDeDiferenca).toBe(0);
  });

  it('aceita alguns dias de diferença — pagou na sexta, lançou na segunda', () => {
    const r = casar(
      [linha(1, '2026-08-17', -1000)],
      [transacao('a', '2026-08-14', -1000)],
    );

    expect(r.casados).toHaveLength(1);
    expect(r.casados[0].como).toBe('proximo');
    expect(r.casados[0].diasDeDiferenca).toBe(3);
  });

  it('não casa o que está longe demais: dois títulos iguais em semanas diferentes', () => {
    const r = casar(
      [linha(1, '2026-08-20', -41.43)],
      [transacao('a', '2026-08-04', -41.43)],
    );

    expect(r.casados).toHaveLength(0);
    expect(r.soNoBanco.map((t) => t.fitId)).toEqual(['a']);
    expect(r.soNoIxc.map((l) => l.id)).toEqual([1]);
  });

  it('usa cada linha uma vez só: o mesmo valor duas vezes no mês são dois pagamentos', () => {
    const r = casar(
      [linha(1, '2026-08-04', -41.43), linha(2, '2026-08-05', -41.43)],
      [transacao('a', '2026-08-04', -41.43), transacao('b', '2026-08-05', -41.43)],
    );

    expect(r.casados).toHaveLength(2);
    const pares = r.casados.map((c) => [c.transacao.fitId, c.linha.id]);
    expect(pares).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('duas iguais no banco e uma só no IXC: uma casa, a outra sobra', () => {
    const r = casar(
      [linha(1, '2026-08-04', -41.43)],
      [transacao('a', '2026-08-04', -41.43), transacao('b', '2026-08-04', -41.43)],
    );

    expect(r.casados).toHaveLength(1);
    expect(r.soNoBanco).toHaveLength(1);
    expect(r.soNoIxc).toHaveLength(0);
  });

  it('o mesmo dia vence a folga na data, mesmo quando o outro vem antes na lista', () => {
    /*
     * Sem a passada em duas etapas, a transação do dia 12 (examinada primeiro)
     * levaria a linha do dia 10 por estar dentro da tolerância — e a transação
     * do dia 10, que é a dona dela, sobraria.
     */
    const r = casar(
      [linha(1, '2026-08-10', -100), linha(2, '2026-08-12', -100)],
      [transacao('doze', '2026-08-12', -100), transacao('dez', '2026-08-10', -100)],
    );

    const pares = Object.fromEntries(
      r.casados.map((c) => [c.transacao.fitId, c.linha.id]),
    );
    expect(pares).toEqual({ doze: 2, dez: 1 });
  });

  it('o documento vence a data: o número do título é prova, o dia é indício', () => {
    const r = casar(
      [
        linha(1, '2026-08-13', -756.57, 'Pag. Comercial Rofe Ltda - doc.: 36508'),
        linha(2, '2026-08-14', -756.57, 'Pag. Outro Fornecedor - doc.: 36509'),
      ],
      [transacao('a', '2026-08-14', -756.57, { documento: '36508' })],
    );

    expect(r.casados).toHaveLength(1);
    expect(r.casados[0].linha.id).toBe(1);
    expect(r.casados[0].como).toBe('documento');
  });

  it('não casa por documento curto demais — "1" está dentro de qualquer histórico', () => {
    const r = casar(
      [linha(1, '2026-08-20', -100, 'Pag. Fulano - doc.: 31415')],
      [transacao('a', '2026-08-01', -100, { documento: '1' })],
    );

    expect(r.casados).toHaveLength(0);
  });

  it('não confunde entrada com saída de mesmo valor', () => {
    const r = casar(
      [linha(1, '2026-08-10', 135)],
      [transacao('a', '2026-08-10', -135)],
    );

    expect(r.casados).toHaveLength(0);
    expect(r.soNoBanco).toHaveLength(1);
    expect(r.soNoIxc).toHaveLength(1);
  });

  it('não perde centavo por causa do ponto flutuante', () => {
    const r = casar(
      [linha(1, '2026-08-10', -0.1 - 0.2)],
      [transacao('a', '2026-08-10', -0.3)],
    );

    expect(r.casados).toHaveLength(1);
  });

  it('extrato vazio deixa tudo do lado do IXC, e vice-versa', () => {
    expect(casar([linha(1, '2026-08-10', -10)], []).soNoIxc).toHaveLength(1);
    expect(casar([], [transacao('a', '2026-08-10', -10)]).soNoBanco).toHaveLength(1);
  });
});
