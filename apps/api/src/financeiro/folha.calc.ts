import { TipoLancamento } from '@prisma/client';

/** Converte "AAAA-MM" em "MM/AAAA" para exibição/observação. */
export function formatCompetencia(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  return m ? `${m[2]}/${m[1]}` : competencia;
}

/** Substitui {competencia} no template de observação. */
export function renderObs(template: string, competencia: string): string {
  return template.replace(/\{competencia\}/g, formatCompetencia(competencia));
}

export interface DadosFolhaFuncionario {
  salarioBase: number;
  /** CLT: adiantamento já é descontado pela contabilidade */
  carteiraAssinada: boolean;
  /** opção de receber o adiantamento do dia 25 */
  recebeAdiantamento: boolean;
  adiantamentoFixo: number;
  descontosFixos: number;
  bonusFixo: number;
}

export interface ParametrosLancamento {
  contaContabilSalario: number;
  contaContabilAdiantamento: number;
  contaContabilBonus: number;
  obsSalario: string; // já renderizado (competência substituída)
  obsAdiantamento: string;
  obsBonus: string;
}

export interface OpcoesGeracao {
  incluirAdiantamento?: boolean;
  incluirSalario?: boolean;
  incluirBonus?: boolean;
}

export interface LancamentoCalculado {
  tipo: TipoLancamento; // SALARIO | ADIANTAMENTO | BONUS
  valor: number;
  contaContabil: number;
  observacao: string;
}

/**
 * Saldo salarial (valor da conta a pagar de SALÁRIO).
 * Para funcionário SEM carteira assinada, o adiantamento é subtraído aqui.
 * Para CLT (carteira assinada), NÃO — a contabilidade já descontou.
 */
export function calcularSaldoSalarial(d: DadosFolhaFuncionario): number {
  const descontaAdiantamento = !d.carteiraAssinada && d.recebeAdiantamento;
  const saldo =
    d.salarioBase -
    d.descontosFixos -
    (descontaAdiantamento ? d.adiantamentoFixo : 0);
  return arredondar(saldo);
}

/**
 * Monta os lançamentos (contas a pagar) sugeridos para um funcionário numa
 * competência. Só inclui itens com valor positivo.
 */
export function montarLancamentosFolha(
  d: DadosFolhaFuncionario,
  params: ParametrosLancamento,
  opcoes: OpcoesGeracao = {},
): LancamentoCalculado[] {
  const {
    incluirAdiantamento = true,
    incluirSalario = true,
    incluirBonus = true,
  } = opcoes;

  const lancamentos: LancamentoCalculado[] = [];

  if (
    incluirAdiantamento &&
    d.recebeAdiantamento &&
    arredondar(d.adiantamentoFixo) > 0
  ) {
    lancamentos.push({
      tipo: TipoLancamento.ADIANTAMENTO,
      valor: arredondar(d.adiantamentoFixo),
      contaContabil: params.contaContabilAdiantamento,
      observacao: params.obsAdiantamento,
    });
  }

  if (incluirSalario) {
    const saldo = calcularSaldoSalarial(d);
    if (saldo > 0) {
      lancamentos.push({
        tipo: TipoLancamento.SALARIO,
        valor: saldo,
        contaContabil: params.contaContabilSalario,
        observacao: params.obsSalario,
      });
    }
  }

  if (incluirBonus && arredondar(d.bonusFixo) > 0) {
    lancamentos.push({
      tipo: TipoLancamento.BONUS,
      valor: arredondar(d.bonusFixo),
      contaContabil: params.contaContabilBonus,
      observacao: params.obsBonus,
    });
  }

  return lancamentos;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
