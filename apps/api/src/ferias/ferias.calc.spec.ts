import {
  diasEntre,
  estaDeFerias,
  fimDasFerias,
  nomeComparavel,
  situacaoDeFerias,
} from './ferias.calc';

/**
 * As contas que decidem a fila de férias.
 *
 * Errar aqui não é errar um número na tela: é mandar alguém para férias antes
 * de ter direito, ou deixar passar a data limite — e depois dela a empresa paga
 * o período em dobro (art. 137 da CLT).
 */

const HOJE = dia('2026-08-13');

/** Quem fechou o período aquisitivo em 23/11/2025, limite 24/10/2026. */
const LUZIA = { periodoFim: dia('2025-11-23'), dataLimite: dia('2026-10-24') };

describe('situacaoDeFerias', () => {
  it('quem fechou os 12 meses já pode sair, e o prazo é contado até o limite', () => {
    const s = situacaoDeFerias(LUZIA, HOJE);

    expect(s.situacao).toBe('LIBERADA');
    expect(s.diasParaLiberar).toBe(0);
    // O mesmo que o relatório imprime, recontado para hoje.
    expect(s.diasAteLimite).toBe(72);
  });

  it('quem ainda está no período aquisitivo aguarda — e sai no dia seguinte ao fechamento', () => {
    const josue = { periodoFim: dia('2026-09-11'), dataLimite: dia('2027-08-12') };

    expect(situacaoDeFerias(josue, HOJE)).toMatchObject({
      situacao: 'AGUARDANDO',
      diasParaLiberar: 30,
    });
    // Fecha 12 meses em 11/09: no dia 11 ainda não, no dia 12 sim.
    expect(situacaoDeFerias(josue, dia('2026-09-11')).situacao).toBe('AGUARDANDO');
    expect(situacaoDeFerias(josue, dia('2026-09-12'))).toMatchObject({
      situacao: 'LIBERADA',
      diasParaLiberar: 0,
    });
  });

  it('no último dia ainda dá tempo; no seguinte, virou dobro', () => {
    expect(situacaoDeFerias(LUZIA, dia('2026-10-24'))).toMatchObject({
      situacao: 'LIBERADA',
      diasAteLimite: 0,
    });
    expect(situacaoDeFerias(LUZIA, dia('2026-10-25'))).toMatchObject({
      situacao: 'VENCIDA',
      diasAteLimite: -1,
    });
  });

  it('a hora do dia não muda a conta', () => {
    const fimDaTarde = new Date('2026-08-13T23:59:00.000Z');
    expect(situacaoDeFerias(LUZIA, fimDaTarde).diasAteLimite).toBe(72);
  });
});

describe('fimDasFerias', () => {
  it('conta o primeiro dia', () => {
    expect(fimDasFerias(dia('2026-09-01'), 30).toISOString().slice(0, 10)).toBe(
      '2026-09-30',
    );
    expect(fimDasFerias(dia('2026-09-01'), 1).toISOString().slice(0, 10)).toBe(
      '2026-09-01',
    );
  });
});

describe('estaDeFerias', () => {
  const ferias = { inicio: dia('2026-08-10'), fim: dia('2026-09-08') };

  it('vale do primeiro ao último dia, inclusive', () => {
    expect(estaDeFerias(ferias, dia('2026-08-10'))).toBe(true);
    expect(estaDeFerias(ferias, dia('2026-09-08'))).toBe(true);
    expect(estaDeFerias(ferias, dia('2026-08-09'))).toBe(false);
    expect(estaDeFerias(ferias, dia('2026-09-09'))).toBe(false);
  });
});

describe('diasEntre', () => {
  it('conta dias inteiros, para frente e para trás', () => {
    expect(diasEntre(dia('2026-08-13'), dia('2026-08-14'))).toBe(1);
    expect(diasEntre(dia('2026-08-14'), dia('2026-08-13'))).toBe(-1);
    // Atravessa o fim do horário de verão sem perder nem ganhar dia.
    expect(diasEntre(dia('2026-01-01'), dia('2027-01-01'))).toBe(365);
  });
});

describe('nomeComparavel', () => {
  it('casa o nome do relatório com o do cadastro', () => {
    expect(nomeComparavel('José  da Silva ')).toBe('JOSE DA SILVA');
    expect(nomeComparavel('JOSUÉ COSTA')).toBe(nomeComparavel('Josue Costa'));
  });
});

function dia(texto: string): Date {
  return new Date(`${texto}T00:00:00.000Z`);
}
