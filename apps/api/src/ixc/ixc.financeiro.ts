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
  /**
   * Tipo de PIX preferencial do cadastro (aba "Dados bancários" do
   * fornecedor). Vazio = deduz pelo formato da chave.
   */
  tipoChavePix?: TipoChavePix | null;
  /**
   * Como esta base guarda o rádio "Tipo da chave Pix". Vazio = manda o rótulo
   * da tela na coluna `tipo_chave_pix`.
   */
  mapaTipoChave?: MapaTipoChavePix | null;
}

/** Tipos da chave PIX, como aparecem na tela de contas a pagar do IXC. */
export const TIPOS_CHAVE_PIX = [
  'CPF/CNPJ',
  'Celular',
  'E-mail',
  'Aleatória',
  'Código copia e cola',
] as const;

export type TipoChavePix = (typeof TIPOS_CHAVE_PIX)[number];

/**
 * Traduz o "tipo de PIX preferencial" do cadastro para o rótulo que a tela de
 * contas a pagar do IXC usa. Entende o rótulo por extenso e o nome da coluna
 * ("pix_celular"), que é como o IXC separa as chaves.
 *
 * Código de uma letra fica de fora de propósito: "C" tanto pode ser celular
 * quanto CPF, e chutar aqui é mandar o pagamento com o tipo errado. Sem
 * tradução, quem decide é a coluna que tem chave preenchida.
 */
export function normalizarTipoChavePix(valor: unknown): TipoChavePix | null {
  const s = String(valor ?? '').trim().toLowerCase();
  if (s.length < 2) return null;
  if (/cel|fone|tel|whats/.test(s)) return 'Celular';
  if (/mail/.test(s)) return 'E-mail';
  if (/cpf|cnpj|documento/.test(s)) return 'CPF/CNPJ';
  if (/aleat|random/.test(s)) return 'Aleatória';
  if (/copia|cola|emv|brcode/.test(s)) return 'Código copia e cola';
  return null;
}

/**
 * Deduz o tipo da chave PIX pelo formato, para marcar o rádio "Tipo da chave
 * Pix" junto do pagamento. Celular e CPF têm 11 dígitos: o desempate é o DDD
 * válido seguido do 9 do celular (CPF não começa com DDD + 9).
 */
export function inferirTipoChavePix(chave?: string | null): TipoChavePix | null {
  const s = String(chave ?? '').trim();
  if (!s) return null;
  if (s.includes('@')) return 'E-mail';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return 'Aleatória';
  }

  const digitos = s.replace(/\D/g, '');
  if (digitos.length === 13 && digitos.startsWith('55')) return 'Celular';
  if (digitos.length === 11 && /^[1-9]{2}9/.test(digitos)) return 'Celular';
  if (digitos.length === 11 || digitos.length === 14) return 'CPF/CNPJ';
  if (s.length > 40) return 'Código copia e cola';
  return null;
}

/**
 * Normaliza a chave PIX para o formato que o banco aceita. Celular vira
 * +55DDDNNNNNNNNN (o IXC guarda com máscara, ex.: "(99) 98107-4450"); as
 * demais seguem como estão.
 */
export function normalizarChavePix(
  chave: string,
  tipo: TipoChavePix | null,
): string {
  if (tipo !== 'Celular') return chave.trim();
  const digitos = chave.replace(/\D/g, '');
  const comPais = digitos.startsWith('55') ? digitos : `55${digitos}`;
  return `+${comPais}`;
}

/**
 * Como esta base do IXC guarda o rádio "Tipo da chave Pix" do fn_apagar.
 *
 * O nome da coluna e o código de cada tipo não estão documentados e variam por
 * instalação — e mandar errado deixa o rádio em branco, o que **trava o
 * pagamento**: o banco recusa PIX sem o tipo da chave. Por isso isto é
 * aprendido das contas que já existem no IXC, não chutado.
 */
export interface MapaTipoChavePix {
  /** Coluna do fn_apagar que guarda o tipo. */
  campo: string;
  /** Rótulo da tela → código cru usado nesta base. */
  codigos: Partial<Record<TipoChavePix, string>>;
}

/** Coluna candidata a guardar o tipo: fala de PIX **e** de tipo. */
function ehColunaTipoPix(coluna: string): boolean {
  return /pix/i.test(coluna) && /tipo/i.test(coluna);
}

/**
 * Descobre, a partir de contas a pagar já existentes no IXC, qual coluna guarda
 * o tipo da chave PIX e que código ela usa para cada tipo.
 *
 * A ideia: numa conta feita na tela do IXC, a chave e o tipo estão coerentes.
 * Então o formato da própria chave (`+55…` = celular, `@` = e-mail) diz qual
 * tipo aquele código representa. Uma coluna que se contradiz — o mesmo tipo com
 * dois códigos diferentes — é descartada, porque não é a coluna do tipo.
 */
export function aprenderTipoChavePix(
  registros: Array<Record<string, unknown>>,
): MapaTipoChavePix | null {
  const porColuna = new Map<string, Map<TipoChavePix, Set<string>>>();

  for (const raw of registros) {
    const tipo = inferirTipoChavePix(String(raw.chave_pix ?? ''));
    if (!tipo) continue;

    for (const [coluna, valor] of Object.entries(raw)) {
      if (!ehColunaTipoPix(coluna)) continue;
      const codigo = String(valor ?? '').trim();
      if (!codigo) continue;

      const porTipo = porColuna.get(coluna) ?? new Map();
      porColuna.set(coluna, porTipo);
      const codigos = porTipo.get(tipo) ?? new Set<string>();
      porTipo.set(tipo, codigos);
      codigos.add(codigo);
    }
  }

  let melhor: MapaTipoChavePix | null = null;
  for (const [campo, porTipo] of porColuna) {
    // Um tipo com dois códigos distintos: esta coluna não é a do tipo.
    if ([...porTipo.values()].some((c) => c.size !== 1)) continue;

    const codigos: Partial<Record<TipoChavePix, string>> = {};
    for (const [tipo, valores] of porTipo) codigos[tipo] = [...valores][0];

    const quantidade = Object.keys(codigos).length;
    if (!melhor || quantidade > Object.keys(melhor.codigos).length) {
      melhor = { campo, codigos };
    }
  }
  return melhor;
}

/**
 * Lê o mapeamento informado à mão em Configurações
 * ("Celular=C, E-mail=E"), para quando não há conta antiga com PIX no IXC
 * de onde aprender.
 */
export function parseCodigosTipoChavePix(
  config?: string | null,
): Partial<Record<TipoChavePix, string>> {
  const codigos: Partial<Record<TipoChavePix, string>> = {};
  for (const par of String(config ?? '').split(/[,;]+/)) {
    const [rotulo, codigo] = par.split('=');
    if (!codigo?.trim()) continue;
    const tipo = normalizarTipoChavePix(rotulo);
    if (tipo) codigos[tipo] = codigo.trim();
  }
  return codigos;
}

/**
 * Coluna e valor do rádio "Tipo da chave Pix". Sem mapa aprendido nem
 * configurado, manda o rótulo da tela na coluna mais provável — que é o
 * comportamento antigo.
 */
export function codificarTipoChavePix(
  tipo: TipoChavePix | null,
  mapa?: MapaTipoChavePix | null,
): { campo: string; valor: string } {
  const campo = mapa?.campo || 'tipo_chave_pix';
  if (!tipo) return { campo, valor: '' };
  return { campo, valor: mapa?.codigos[tipo] ?? tipo };
}

/** Monta o corpo do POST /fn_apagar (conta a pagar). */
export function buildContaPagarPayload(
  input: ContaPagarInput,
): Record<string, unknown> {
  const chave = (input.chavePix ?? '').trim();
  // O tipo preferencial do cadastro manda: é o que o IXC mostra marcado na aba
  // "Dados bancários" do fornecedor, e a conta a pagar tem que repetir. Só
  // quando o cadastro não diz é que se deduz pelo formato da chave.
  const tipoChave = input.tipoChavePix ?? inferirTipoChavePix(chave);
  const radio = codificarTipoChavePix(tipoChave, input.mapaTipoChave);

  return {
    id_fornecedor: String(input.idFornecedor),
    data_emissao: formatDataIxc(input.dataEmissao),
    data_vencimento: formatDataIxc(input.dataVencimento),
    valor: formatValorIxc(input.valor),
    id_contas: String(input.contaPagamentoId), // conta de pagamento (18)
    tipo_pagamento: input.tipoPagamento ?? 'Pix',
    id_conta: String(input.contaContabilId), // conta contábil (2420/2662/13916)
    filial_id: String(input.filialId),
    chave_pix: chave ? normalizarChavePix(chave, tipoChave) : '',
    // Rádio "Tipo da chave Pix" da tela de contas a pagar.
    [radio.campo]: radio.valor,
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
  /** `fn_apagar.status = C`: cancelada na tela do IXC. */
  cancelada: boolean;
  statusAuditoria: StatusAuditoriaIxc | null;
  valorPago: number;
  valorAberto: number;
  dataPagamento: Date | null;
}

/**
 * Status da auditoria dentro de um registro cru. O nome da coluna varia entre
 * versões do IXC, então procura os nomes conhecidos e, por fim, qualquer campo
 * com "audit" no nome. Null = o registro não fala de auditoria (aí quem sabe é
 * a tabela `fn_apagar_auditoria`).
 */
export function lerStatusAuditoria(
  raw: Record<string, unknown>,
): StatusAuditoriaIxc | null {
  const candidatos = ['status_auditoria', 'auditoria', 'status_aud'];
  for (const campo of candidatos) {
    const v = normalizarStatusAuditoria(raw[campo]);
    if (v) return v;
  }
  for (const [chave, valor] of Object.entries(raw)) {
    if (!/audit/i.test(chave)) continue;
    const v = normalizarStatusAuditoria(valor);
    if (v) return v;
  }
  return null;
}

function normalizarStatusAuditoria(valor: unknown): StatusAuditoriaIxc | null {
  const s = String(valor ?? '').trim().toUpperCase();
  if (s === 'A' || s === 'R' || s === 'C') return s;
  // Algumas telas devolvem o rótulo em vez do código.
  if (s.startsWith('APROV')) return 'A';
  if (s.startsWith('REPROV')) return 'R';
  if (s.startsWith('CANCEL')) return 'C';
  return null;
}

/**
 * Interpreta um registro cru de fn_apagar para descobrir se já foi pago
 * (retorno do banco), se foi cancelado e o status da auditoria. Defensivo
 * quanto a formatos.
 */
export function lerSituacaoContaPagar(
  raw: Record<string, unknown>,
): SituacaoContaPagarIxc {
  const valorPago = parseIxcDecimal(raw.valor_total_pago ?? raw.valor_pago);
  const valorAberto = parseIxcDecimal(raw.valor_aberto ?? raw.valor);
  const dataPagamento = parseIxcDate(raw.data_pagamento);
  // fn_apagar.status: A = aberto, P = pago, C = cancelado.
  const status = String(raw.status ?? '').trim().toUpperCase();

  const pago =
    status === 'P' ||
    dataPagamento !== null ||
    (valorPago > 0 && valorAberto <= 0.001);

  return {
    pago,
    cancelada: status === 'C',
    statusAuditoria: lerStatusAuditoria(raw),
    valorPago,
    valorAberto,
    dataPagamento,
  };
}
