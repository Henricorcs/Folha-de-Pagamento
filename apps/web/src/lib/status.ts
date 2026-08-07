import type { Tom } from '../components/ui';
import type { SentidoVale, StatusContaPagar, TipoLancamento } from './types';

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

/** Cor conta história: verde só quando o banco confirmou. */
export const STATUS_TOM: Record<StatusContaPagar, Tom> = {
  RASCUNHO: 'neutro',
  AGUARDANDO_APROVACAO: 'atencao',
  APROVADO: 'info',
  REPROVADO: 'erro',
  AGUARDANDO_PAGAMENTO: 'info',
  PAGO: 'pago',
  CANCELADO: 'neutro',
  ERRO: 'erro',
};

export const TIPO_LABEL: Record<TipoLancamento, string> = {
  SALARIO: 'Salário',
  ADIANTAMENTO: 'Adiantamento',
  BONUS: 'Bônus',
  DESCONTO: 'Desconto',
  AVULSO: 'Avulso',
};

/**
 * Quem deve — não o que a folha faz. Sem isso o selo brigava com o "fora da
 * folha" ("Desconta da folha · fora da folha").
 */
export const SENTIDO_LABEL: Record<SentidoVale, string> = {
  DESCONTO: 'Funcionário paga a empresa',
  CREDITO: 'Empresa paga o funcionário',
};

export const SENTIDO_CURTO: Record<SentidoVale, string> = {
  DESCONTO: 'Funcionário deve',
  CREDITO: 'Empresa deve',
};

export const SENTIDO_TOM: Record<SentidoVale, Tom> = {
  DESCONTO: 'atencao',
  CREDITO: 'pago',
};
