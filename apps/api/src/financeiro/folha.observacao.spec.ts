import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sufixoObservacaoSalario, type DadosFolhaFuncionario } from './folha.calc';

/**
 * A observação da conta a pagar virou fonte de dado, não só texto para humano:
 * a migração `20260813120000_comissao_das_folhas_antigas` lê dela a comissão
 * das folhas geradas antes de existir coluna para guardá-la. Era o único
 * registro do que de fato foi pago.
 *
 * Isso amarra o formato. Se alguém mudar o texto do sufixo, a migração passa a
 * não casar — e, como ela já rodou nos bancos existentes, o estrago seria
 * silencioso nos próximos. Este arquivo existe para a mudança doer aqui
 * primeiro, com o motivo à vista.
 */

/** O mesmo padrão do UPDATE, em sintaxe JavaScript. */
const PADRAO = /COMISS[^:]*: ([0-9]+) x R[$] [0-9.,]+ = R[$] ([0-9.,]+)/;

const BASE: DadosFolhaFuncionario = {
  salarioBase: 2000,
  carteiraAssinada: false,
  valorAReceberFolha: null,
  recebeAdiantamento: false,
  valorAdiantamento: null,
  adiantamentoFixo: 0,
  descontosFixos: 0,
  bonusFixo: 0,
  vendas: 0,
  valorPorVenda: 0,
  horasExtras: 0,
  descontoVales: 0,
  creditoVales: 0,
};

/** O que a migração faz com o que casou: texto brasileiro vira número. */
function lerComissao(observacao: string): { vendas: number; valor: number } | null {
  const m = PADRAO.exec(observacao);
  if (!m) return null;
  return {
    vendas: Number(m[1]),
    valor: Number(m[2].replace(/\./g, '').replace(',', '.')),
  };
}

describe('a comissão continua legível na observação', () => {
  it('lê vendas e valor de um salário com comissão', () => {
    const obs = sufixoObservacaoSalario({
      ...BASE,
      vendas: 12,
      valorPorVenda: 50,
    });
    expect(lerComissao(obs)).toEqual({ vendas: 12, valor: 600 });
  });

  /** Onde o ponto de milhar entra — e é ele que quebraria um cast ingênuo. */
  it('lê valor na casa dos milhares', () => {
    const obs = sufixoObservacaoSalario({
      ...BASE,
      vendas: 250,
      valorPorVenda: 50,
    });
    expect(lerComissao(obs)).toEqual({ vendas: 250, valor: 12500 });
  });

  /** A comissão convive com horas extras, reembolso e vale no mesmo sufixo. */
  it('acha a comissão no meio dos outros termos', () => {
    const obs = sufixoObservacaoSalario({
      ...BASE,
      horasExtras: 500,
      vendas: 3,
      valorPorVenda: 5,
      creditoVales: 80,
      descontoVales: 100,
    });
    expect(lerComissao(obs)).toEqual({ vendas: 3, valor: 15 });
  });

  it('salário sem venda não casa — e continua em zero', () => {
    expect(lerComissao(sufixoObservacaoSalario(BASE))).toBeNull();
    expect(
      lerComissao(sufixoObservacaoSalario({ ...BASE, horasExtras: 300 })),
    ).toBeNull();
  });

  /** O padrão do teste tem de ser o mesmo que roda no banco. */
  it('usa o mesmo padrão que a migração', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20260813120000_comissao_das_folhas_antigas/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain(PADRAO.source);
  });
});
