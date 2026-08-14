/**
 * As contas da fila de férias.
 *
 * Duas datas mandam na vida de cada pessoa, e elas respondem perguntas
 * diferentes:
 *
 * - **fim do período aquisitivo** — a partir do dia seguinte a pessoa *pode*
 *   sair. Antes disso ela ainda está juntando os 12 meses (2,5 dias por mês);
 * - **data limite** — o último dia em que as férias podem *começar* sem a
 *   empresa cair no pagamento em dobro (art. 137 da CLT). É o que ordena a
 *   fila: quem tem menos prazo vai primeiro, tenha entrado quando tiver.
 *
 * Tudo aqui é contado em dias de calendário no UTC, porque data de férias é
 * dia, não instante: somar fuso faria "faltam 0 dias" virar "faltam 1" ao
 * anoitecer.
 */

/** Onde a pessoa está em relação ao próprio prazo. */
export type SituacaoFerias =
  /** Passou da data limite: as férias viraram dobro para a empresa. */
  | 'VENCIDA'
  /** Já completou o período aquisitivo e pode sair. */
  | 'LIBERADA'
  /** Ainda está juntando os 12 meses. */
  | 'AGUARDANDO';

export interface PrazoDeFerias {
  periodoFim: Date;
  dataLimite: Date;
}

export interface SituacaoCalculada {
  situacao: SituacaoFerias;
  /** Dias até a data limite; negativo = dias que já passaram dela. */
  diasAteLimite: number;
  /** Dias até poder sair; 0 quando o período aquisitivo já fechou. */
  diasParaLiberar: number;
}

/** Dias inteiros de `de` até `ate` (negativo quando `ate` já passou). */
export function diasEntre(de: Date, ate: Date): number {
  const UM_DIA = 24 * 60 * 60 * 1000;
  return Math.round((soData(ate).getTime() - soData(de).getTime()) / UM_DIA);
}

/** Meia-noite UTC do dia — hora não entra em conta de férias. */
export function soData(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}

export function situacaoDeFerias(
  prazo: PrazoDeFerias,
  hoje: Date,
): SituacaoCalculada {
  const diasAteLimite = diasEntre(hoje, prazo.dataLimite);
  // O direito nasce no dia seguinte ao fechamento do período aquisitivo: quem
  // fecha 12 meses hoje sai a partir de amanhã.
  const diasParaLiberar = Math.max(0, diasEntre(hoje, prazo.periodoFim) + 1);

  const situacao: SituacaoFerias =
    diasAteLimite < 0 ? 'VENCIDA' : diasParaLiberar === 0 ? 'LIBERADA' : 'AGUARDANDO';

  return { situacao, diasAteLimite, diasParaLiberar };
}

/** Último dia das férias: o primeiro dia já conta. */
export function fimDasFerias(inicio: Date, dias: number): Date {
  const fim = soData(inicio);
  fim.setUTCDate(fim.getUTCDate() + Math.max(Math.round(dias), 1) - 1);
  return fim;
}

/** Está de férias hoje: já começou e ainda não terminou. */
export function estaDeFerias(
  ferias: { inicio: Date; fim: Date },
  hoje: Date,
): boolean {
  return (
    diasEntre(hoje, ferias.inicio) <= 0 && diasEntre(hoje, ferias.fim) >= 0
  );
}

/**
 * Nome comparável entre o PDF da contabilidade e o cadastro daqui: sem acento,
 * sem caixa e sem espaço sobrando. Um é digitado por gente diferente do outro,
 * e "JOSUÉ" e "JOSUE" são a mesma pessoa.
 */
export function nomeComparavel(nome: string): string {
  return nome
    // NFD separa a letra do acento; \p{M} varre os acentos que sobraram.
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
