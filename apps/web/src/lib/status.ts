import type { StatusContaPagar, TipoLancamento } from './types';

export const STATUS_LABEL: Record<StatusContaPagar, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  APROVADO: 'Aprovado',
  REPROVADO: 'Reprovado',
  AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
  PAGO: 'Pago',
  CANCELADO: 'Cancelado',
  ERRO: 'Erro',
};

export const STATUS_CLASSE: Record<StatusContaPagar, string> = {
  RASCUNHO: 'bg-slate-100 text-slate-600',
  AGUARDANDO_APROVACAO: 'bg-amber-100 text-amber-700',
  APROVADO: 'bg-sky-100 text-sky-700',
  REPROVADO: 'bg-red-100 text-red-700',
  AGUARDANDO_PAGAMENTO: 'bg-indigo-100 text-indigo-700',
  PAGO: 'bg-green-100 text-green-700',
  CANCELADO: 'bg-slate-100 text-slate-500',
  ERRO: 'bg-red-100 text-red-700',
};

export const TIPO_LABEL: Record<TipoLancamento, string> = {
  SALARIO: 'Salário',
  ADIANTAMENTO: 'Adiantamento',
  BONUS: 'Bônus',
  DESCONTO: 'Desconto',
  AVULSO: 'Avulso',
};
