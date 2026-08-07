import type { Funcionario } from './types';

type BaseFuncionario = Pick<
  Funcionario,
  'salarioBase' | 'carteiraAssinada' | 'valorAReceberFolha'
>;

/**
 * Quem tem carteira assinada recebe o salário oficial pela contabilidade; a
 * folha daqui paga o combinado em "a receber na folha". Sem esse valor, vale
 * o salário base. Mesma regra do `baseDaFolha` da API.
 */
export function usaValorAReceber(f: BaseFuncionario): boolean {
  return !!f.carteiraAssinada && Number(f.valorAReceberFolha ?? 0) > 0;
}

/** Valor que a folha usa como base para essa pessoa. */
export function baseDaFolha(f: BaseFuncionario): string {
  return usaValorAReceber(f) ? f.valorAReceberFolha! : f.salarioBase;
}
