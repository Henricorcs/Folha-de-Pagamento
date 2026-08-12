import type { Funcionario, ValeComSaldo } from './types';

type BaseFuncionario = Pick<
  Funcionario,
  'salarioBase' | 'carteiraAssinada' | 'valorAReceberFolha'
>;

/**
 * Quem tem carteira assinada recebe o salário oficial pela contabilidade; a
 * folha daqui paga o combinado em "a receber na folha". Sem esse valor, vale
 * o salário base. Mesma regra do `baseDaFolha` da API — e, como lá, isso vale
 * para o saldo salarial, não para os 40% do dia 25 (esses saem do base).
 */
export function usaValorAReceber(f: BaseFuncionario): boolean {
  return !!f.carteiraAssinada && Number(f.valorAReceberFolha ?? 0) > 0;
}

/** Valor que a folha usa como base para essa pessoa. */
export function baseDaFolha(f: BaseFuncionario): string {
  return usaValorAReceber(f) ? f.valorAReceberFolha! : f.salarioBase;
}

/**
 * Qual parcela está sendo paga agora ("3/7"). Parcela começa em 1: quando
 * nenhuma foi acertada ainda, a da vez é a primeira. Quitado, mostra a última.
 */
export function rotuloParcelaAtual(v: ValeComSaldo): string {
  const total = v.vale.quantidadeParcelas;
  return `${v.proximaParcela?.numero ?? total}/${total}`;
}

// ---------------------------------------------------------------------------
// Meses
//
// A empresa paga o trabalho de um mês no mês seguinte: o salário de agosto sai
// em setembro. As telas perguntam pelo **mês trabalhado**, que é como se fala
// ("a folha de agosto"), e traduzem para o mês do pagamento na hora de chamar a
// API — que trabalha em cima do mês em que o dinheiro sai.
// ---------------------------------------------------------------------------

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "AAAA-MM" do mês corrente. */
export function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function deslocar(competencia: string, meses: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  if (!m) return competencia;
  // Dia 1 de propósito: somar mês em cima do dia 31 escorrega para o mês
  // seguinte ("31/01" + 1 mês = 03/03).
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + meses, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function mesSeguinte(competencia: string): string {
  return deslocar(competencia, 1);
}

export function mesAnterior(competencia: string): string {
  return deslocar(competencia, -1);
}

/** "2026-08" → "agosto/2026", que é como se lê em voz alta. */
export function nomeDoMes(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  return m ? `${MESES[Number(m[2]) - 1]}/${m[1]}` : competencia;
}
