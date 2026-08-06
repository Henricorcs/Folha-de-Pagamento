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

/**
 * Mês anterior a "AAAA-MM" ("2026-08" → "2026-07").
 *
 * O salário e o bônus pagos numa competência se referem ao mês trabalhado, que
 * é o anterior; só o adiantamento do dia 25 fala do mês corrente.
 */
export function competenciaAnterior(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  if (!m) return competencia;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  return `${anterior.ano}-${String(anterior.mes).padStart(2, '0')}`;
}

/** Percentual do salário adiantado no dia 25 quando não há valor fixo. */
export const PERCENTUAL_ADIANTAMENTO_PADRAO = 40;

export interface DadosFolhaFuncionario {
  salarioBase: number;
  /** CLT: adiantamento já é descontado pela contabilidade */
  carteiraAssinada: boolean;
  /** opção de receber o adiantamento do dia 25 */
  recebeAdiantamento: boolean;
  /** valor definido no cadastro para o dia 25; vazio = cai no percentual */
  valorAdiantamento?: number | null;
  /** lançamento de adiantamento cadastrado; 0 = usa o percentual */
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
  /** % do salário no adiantamento do dia 25 (padrão 40) */
  percentualAdiantamento?: number;
}

/**
 * Valor do adiantamento do dia 25. Quem não recebe adiantamento fica em zero.
 * Ordem: valor definido no cadastro → lançamento de ADIANTAMENTO → percentual
 * do salário base (40% por padrão).
 */
export function calcularAdiantamento(
  d: DadosFolhaFuncionario,
  percentual = PERCENTUAL_ADIANTAMENTO_PADRAO,
): number {
  if (!d.recebeAdiantamento) return 0;
  const doCadastro = arredondar(d.valorAdiantamento ?? 0);
  if (doCadastro > 0) return doCadastro;
  const fixo = arredondar(d.adiantamentoFixo);
  if (fixo > 0) return fixo;
  return arredondar((d.salarioBase * percentual) / 100);
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
export function calcularSaldoSalarial(
  d: DadosFolhaFuncionario,
  percentual = PERCENTUAL_ADIANTAMENTO_PADRAO,
): number {
  const adiantamento = calcularAdiantamento(d, percentual);
  const saldo =
    d.salarioBase - d.descontosFixos - (d.carteiraAssinada ? 0 : adiantamento);
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

  const percentual =
    params.percentualAdiantamento ?? PERCENTUAL_ADIANTAMENTO_PADRAO;
  const adiantamento = calcularAdiantamento(d, percentual);
  const lancamentos: LancamentoCalculado[] = [];

  if (incluirAdiantamento && adiantamento > 0) {
    lancamentos.push({
      tipo: TipoLancamento.ADIANTAMENTO,
      valor: adiantamento,
      contaContabil: params.contaContabilAdiantamento,
      observacao: params.obsAdiantamento,
    });
  }

  if (incluirSalario) {
    const saldo = calcularSaldoSalarial(d, percentual);
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
