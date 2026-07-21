import { parseIxcDate, parseIxcDecimal } from './ixc.parse';

/** Formata Date como "DD/MM/AAAA" (formato aceito pelo IXC). */
export function formatDataIxc(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const y = date.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

/** Formata valor monetário como string com ponto decimal ("1234.56"). */
export function formatValorIxc(valor: number): string {
  return (Math.round(valor * 100) / 100).toFixed(2);
}

export interface FornecedorInput {
  nome: string;
  cpfCnpj?: string | null;
  tipoPessoa?: string; // "F" | "J"
  cidadeId: number;
  email?: string | null;
  celular?: string | null;
  obs?: string;
}

/** Monta o corpo do POST /fornecedor. */
export function buildFornecedorPayload(
  input: FornecedorInput,
): Record<string, unknown> {
  const tipoPessoa = input.tipoPessoa === 'J' ? 'J' : 'F';
  return {
    ativo: 'S',
    tipo_pessoa: tipoPessoa,
    razao: input.nome.trim(),
    fantasia: input.nome.trim(),
    cpf_cnpj: input.cpfCnpj ?? '',
    data: formatDataIxc(new Date()),
    cidade: String(input.cidadeId),
    email: input.email ?? '',
    celular: input.celular ?? '',
    obs: input.obs ?? '',
  };
}

export interface ContaPagarInput {
  idFornecedor: number;
  valor: number;
  contaPagamentoId: number; // id_contas
  contaContabilId: number; // id_conta (planejamento analítico)
  filialId: number;
  dataEmissao: Date;
  dataVencimento: Date;
  observacao: string;
  tipoPagamento?: string; // default "Dinheiro"
  chavePix?: string | null;
}

/** Monta o corpo do POST /fn_apagar (conta a pagar). */
export function buildContaPagarPayload(
  input: ContaPagarInput,
): Record<string, unknown> {
  return {
    id_fornecedor: String(input.idFornecedor),
    data_emissao: formatDataIxc(input.dataEmissao),
    data_vencimento: formatDataIxc(input.dataVencimento),
    valor: formatValorIxc(input.valor),
    id_contas: String(input.contaPagamentoId), // conta de pagamento (18)
    tipo_pagamento: input.tipoPagamento ?? 'Dinheiro',
    id_conta: String(input.contaContabilId), // conta contábil (2420/2662/13916)
    filial_id: String(input.filialId),
    chave_pix: input.chavePix ?? '',
    previsao: 'N',
    liberado: 'S',
    obs: input.observacao,
  };
}

export type StatusAuditoriaIxc = 'A' | 'R' | 'C';

/** Monta o corpo do POST /fn_apagar_auditoria (aprovar/reprovar). */
export function buildAuditoriaPayload(input: {
  idFnApagar: number;
  status: StatusAuditoriaIxc;
  motivo: string;
  operador?: string;
}): Record<string, unknown> {
  return {
    status: input.status,
    id_fn_apagar: String(input.idFnApagar),
    tipo: 'E', // Externo (via API)
    motivo: input.motivo,
    operador: input.operador ?? '',
    data_hora: '',
  };
}

/** Situação lida de um registro fn_apagar do IXC. */
export interface SituacaoContaPagarIxc {
  pago: boolean;
  statusAuditoria: 'A' | 'R' | 'C' | null;
  valorPago: number;
  valorAberto: number;
  dataPagamento: Date | null;
}

/**
 * Interpreta um registro cru de fn_apagar para descobrir se já foi pago
 * (retorno do banco) e o status da auditoria. Defensivo quanto a formatos.
 */
export function lerSituacaoContaPagar(
  raw: Record<string, unknown>,
): SituacaoContaPagarIxc {
  const valorPago = parseIxcDecimal(raw.valor_total_pago ?? raw.valor_pago);
  const valorAberto = parseIxcDecimal(raw.valor_aberto ?? raw.valor);
  const dataPagamento = parseIxcDate(raw.data_pagamento);
  const status = String(raw.status ?? '').trim().toUpperCase();
  const statusAud = String(raw.status_auditoria ?? '').trim().toUpperCase();

  const pago =
    status === 'P' ||
    dataPagamento !== null ||
    (valorPago > 0 && valorAberto <= 0.001);

  const statusAuditoria =
    statusAud === 'A' || statusAud === 'R' || statusAud === 'C'
      ? (statusAud as 'A' | 'R' | 'C')
      : null;

  return { pago, statusAuditoria, valorPago, valorAberto, dataPagamento };
}
