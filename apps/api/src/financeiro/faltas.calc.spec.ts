import { calcularDescontoDeFaltas, domingoDaSemana } from './faltas.calc';

/**
 * O que este arquivo protege: uma falta custa o dia **e** o descanso da semana,
 * e o descanso é um por semana — não um por falta. Errar para cima cobra da
 * pessoa um domingo que ela não tinha para perder; errar para baixo é o erro
 * que quem calcula à mão já comete sozinho.
 */

/**
 * Agosto de 2026: 2, 9, 16, 23 e 30 são domingos.
 *
 * Em UTC, como as faltas nascem: construídas no fuso de quem roda o teste, elas
 * passariam aqui e falhariam num servidor a leste de Greenwich — que é
 * exatamente o tipo de erro que este módulo existe para não ter.
 */
const dia = (d: number) => new Date(Date.UTC(2026, 7, d));

describe('o desconto das faltas', () => {
  it('sem falta, não desconta nada', () => {
    const r = calcularDescontoDeFaltas(3000, []);

    expect(r.total).toBe(0);
    expect(r.semanasComFalta).toBe(0);
  });

  /* O valor do dia é o salário por 30, e não pelos dias do mês: a mesma falta
     não pode custar mais em fevereiro do que em março. */
  it('um dia custa o salário dividido por trinta', () => {
    const r = calcularDescontoDeFaltas(3000, [dia(4)]);

    expect(r.valorDoDia).toBe(100);
    expect(r.valorDosDias).toBe(100);
  });

  it('uma falta leva junto o descanso da semana', () => {
    const r = calcularDescontoDeFaltas(3000, [dia(4)]);

    expect(r.dias).toBe(1);
    expect(r.semanasComFalta).toBe(1);
    expect(r.valorDoDsr).toBe(100);
    // O dia mais o domingo.
    expect(r.total).toBe(200);
  });

  /*
   * Três faltas na mesma semana derrubam o mesmo domingo. Contá-lo três vezes
   * cobraria um descanso que a pessoa não tinha para perder.
   */
  it('faltas na mesma semana perdem um só descanso', () => {
    // 4, 5 e 6 de agosto: terça, quarta e quinta da mesma semana.
    const r = calcularDescontoDeFaltas(3000, [dia(4), dia(5), dia(6)]);

    expect(r.dias).toBe(3);
    expect(r.semanasComFalta).toBe(1);
    expect(r.total).toBe(400);
  });

  it('faltas em semanas diferentes perdem um descanso cada', () => {
    // 4 de agosto (semana do dia 2) e 11 (semana do dia 9).
    const r = calcularDescontoDeFaltas(3000, [dia(4), dia(11)]);

    expect(r.semanasComFalta).toBe(2);
    expect(r.total).toBe(400);
  });

  /* A semana começa no domingo: sábado e a segunda seguinte são semanas
     diferentes, mesmo com um dia de intervalo. */
  it('sábado e a segunda seguinte são semanas diferentes', () => {
    // 8 de agosto é sábado; 10 é a segunda da semana seguinte.
    const r = calcularDescontoDeFaltas(3000, [dia(8), dia(10)]);

    expect(r.semanasComFalta).toBe(2);
  });

  it('o próprio domingo faltado conta a semana dele', () => {
    const r = calcularDescontoDeFaltas(3000, [dia(9)]);

    expect(domingoDaSemana(dia(9)).getUTCDate()).toBe(9);
    expect(r.semanasComFalta).toBe(1);
  });

  it('arredonda em centavos, e não em fração de centavo', () => {
    // 1621 / 30 = 54,0333…
    const r = calcularDescontoDeFaltas(1621, [dia(4)]);

    expect(r.valorDoDia).toBe(54.03);
    expect(r.total).toBe(108.06);
  });
});
