/**
 * Filtro que identifica funcionários dentro do cadastro de `fornecedor` do IXC.
 *
 * Regra do usuário: **fornecedor com "Contribuinte ICMS" = Isento é
 * funcionário**. O cadastro de fornecedor é onde ficam, de fato, os dados
 * bancários e a chave PIX usados no pagamento — por isso ele é a fonte tanto da
 * lista de funcionários ativos quanto dos dados de pagamento.
 *
 * O nome exato da coluna de ICMS e o código que representa "Isento" variam
 * entre bases do IXC, então aqui nada é chutado às cegas: o campo é detectado
 * pelo nome (qualquer coluna com "icms") e os valores aceitos são
 * parametrizáveis. `distribuicaoIcms` existe para diagnosticar a base real.
 */
import { Prisma } from '@prisma/client';
import { extrairDadosBancarios } from './ixc.mappers';
import { parseIxcId } from './ixc.parse';
import type { IxcFornecedor } from './ixc.types';

/** Valores textuais que indicam "Isento" sem ambiguidade. */
export const VALORES_ICMS_ISENTO_PADRAO = ['I', 'ISENTO'];

/** Dados de um funcionário extraídos do cadastro de fornecedor. */
export interface FuncionarioDoFornecedor {
  idFornecedor: number;
  nome: string;
  cpfCnpj: string | null;
  email: string | null;
  telefone: string | null;
  cidadeIxc: number | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  /** Valor cru do campo de ICMS que fez o registro entrar no filtro. */
  icms: string;
}

/**
 * Descobre qual coluna do fornecedor guarda o "Contribuinte ICMS".
 * Prefere a que também menciona "contribuinte" (ex.: `contribuinte_icms`),
 * depois um campo chamado exatamente `icms`, e por fim qualquer uma com "icms".
 */
export function detectarCampoIcms(
  registros: Array<Record<string, unknown>>,
): string | null {
  for (const raw of registros) {
    const comIcms = Object.keys(raw).filter((k) => /icms/i.test(k));
    if (comIcms.length === 0) continue;
    return (
      comIcms.find((k) => /contribu/i.test(k)) ??
      comIcms.find((k) => /^icms$/i.test(k)) ??
      comIcms[0]
    );
  }
  return null;
}

/** Valor normalizado (maiúsculas, sem espaços) do campo de ICMS. */
export function lerIcms(
  raw: Record<string, unknown>,
  campo: string | null,
): string {
  if (!campo) return '';
  return String(raw[campo] ?? '').trim().toUpperCase();
}

/**
 * Converte a lista configurada ("I, ISENTO, 2") em valores comparáveis.
 * Vazio cai no padrão textual.
 */
export function parseValoresIsento(config?: string | null): string[] {
  const itens = String(config ?? '')
    .split(/[,;\s]+/)
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
  return itens.length > 0 ? itens : [...VALORES_ICMS_ISENTO_PADRAO];
}

/** true quando o valor do campo de ICMS significa "Isento". */
export function ehIcmsIsento(valor: string, valoresIsento: string[]): boolean {
  const v = valor.trim().toUpperCase();
  if (!v) return false;
  // Texto é inequívoco ("ISENTO", "Isento de ICMS"): vale sempre.
  if (v.includes('ISENT')) return true;
  return valoresIsento.includes(v);
}

/** Só os dígitos do CPF/CNPJ, para comparar "082.935.753-01" com "08293575301". */
export function somenteDigitos(doc?: string | null): string {
  return String(doc ?? '').replace(/\D/g, '');
}

/** Nome do fornecedor: razão social e, se faltar, fantasia. */
export function nomeFornecedor(raw: IxcFornecedor): string {
  return (
    textoOuNull(raw.razao) ??
    textoOuNull(raw.fantasia) ??
    textoOuNull(raw.nome) ??
    ''
  );
}

/** Converte um fornecedor cru em dados de funcionário (null se id inválido). */
export function mapFornecedorParaFuncionario(
  raw: IxcFornecedor,
  icms = '',
): FuncionarioDoFornecedor | null {
  const idFornecedor = parseIxcId(raw.id);
  if (idFornecedor === null) return null;

  const bancarios = extrairDadosBancarios(raw);
  return {
    idFornecedor,
    nome: nomeFornecedor(raw) || `Fornecedor ${idFornecedor}`,
    cpfCnpj: textoOuNull(raw.cnpj_cpf) ?? textoOuNull(raw.cpf_cnpj),
    email: textoOuNull(raw.email),
    telefone:
      textoOuNull(raw.celular) ??
      textoOuNull(raw.fone_celular) ??
      textoOuNull(raw.fone),
    cidadeIxc: parseIxcId(raw.cidade) ?? parseIxcId(raw.id_cidade),
    ...bancarios,
    icms,
  };
}

/**
 * Aplica o filtro sobre os fornecedores lidos do IXC e devolve os que são
 * funcionários, junto do campo de ICMS efetivamente usado.
 */
export function filtrarFuncionariosIsentos(
  registros: IxcFornecedor[],
  opts: { campoIcms?: string | null; valoresIsento?: string[] } = {},
): { campoIcms: string | null; funcionarios: FuncionarioDoFornecedor[] } {
  const campoIcms = opts.campoIcms?.trim() || detectarCampoIcms(registros);
  if (!campoIcms) return { campoIcms: null, funcionarios: [] };

  const valores = opts.valoresIsento?.length
    ? opts.valoresIsento.map((v) => v.trim().toUpperCase())
    : [...VALORES_ICMS_ISENTO_PADRAO];

  const funcionarios: FuncionarioDoFornecedor[] = [];
  for (const raw of registros) {
    const icms = lerIcms(raw, campoIcms);
    if (!ehIcmsIsento(icms, valores)) continue;
    const mapeado = mapFornecedorParaFuncionario(raw, icms);
    if (mapeado) funcionarios.push(mapeado);
  }
  return { campoIcms, funcionarios };
}

/** Um valor distinto do campo de ICMS e quantos fornecedores o usam. */
export interface OcorrenciaIcms {
  valor: string;
  quantidade: number;
  exemplos: string[];
}

/**
 * Distribuição dos valores do campo de ICMS na base — é o que permite
 * confirmar qual código significa "Isento" sem adivinhação.
 */
export function distribuicaoIcms(
  registros: IxcFornecedor[],
  campoIcms: string | null,
  maxExemplos = 3,
): OcorrenciaIcms[] {
  const mapa = new Map<string, OcorrenciaIcms>();
  for (const raw of registros) {
    const valor = lerIcms(raw, campoIcms) || '(vazio)';
    const atual = mapa.get(valor) ?? { valor, quantidade: 0, exemplos: [] };
    atual.quantidade += 1;
    if (atual.exemplos.length < maxExemplos) {
      const nome = nomeFornecedor(raw);
      if (nome) atual.exemplos.push(nome);
    }
    mapa.set(valor, atual);
  }
  return [...mapa.values()].sort((a, b) => b.quantidade - a.quantidade);
}

// ---------------------------------------------------------------------------
// Dados bancários: ficam na aba "Dados bancários" do fornecedor, que é uma
// tabela própria (grid com banco, agência, conta, titular e três colunas de
// PIX) — e NÃO no registro do fornecedor. Por isso banco/agência/conta/PIX
// vinham vazios ao ler só `fornecedor`.
// ---------------------------------------------------------------------------

/** Nomes prováveis da tabela do grid, tentados em ordem até um responder. */
export const TABELAS_DADOS_BANCARIOS = [
  'fornecedor_dados_bancarios',
  'fornecedores_dados_bancarios',
  'dados_bancarios_fornecedor',
  'fornecedor_conta_bancaria',
  'fornecedor_banco',
  'fn_dados_bancarios',
  'dados_bancarios',
];

const CAMPOS_BANCO = [
  'banco',
  'nome_banco',
  'banco_nome',
  'descricao_banco',
  'codigo_banco',
  'cod_banco',
];
const CAMPOS_AGENCIA = [
  'agencia',
  'codigo_agencia',
  'cod_agencia',
  'agencia_codigo',
  'numero_agencia',
];
const CAMPOS_CONTA = [
  'conta',
  'codigo_conta',
  'cod_conta',
  'conta_codigo',
  'numero_conta',
  'conta_corrente',
];
/** Ordem de preferência da chave PIX (o IXC separa em três colunas). */
const CAMPOS_PIX = [
  'chave_pix',
  'pix_cpf_cnpj',
  'pix_cnpj_cpf',
  'pix_email',
  'pix_e_mail',
  'pix_celular',
  'pix_telefone',
  'pix',
];

/** Descobre o campo que liga a linha do grid ao fornecedor. */
export function detectarCampoFornecedor(
  raw: Record<string, unknown>,
): string | null {
  const chaves = Object.keys(raw);
  return (
    chaves.find((k) => /^id_fornecedor$/i.test(k)) ??
    chaves.find((k) => /fornecedor/i.test(k)) ??
    chaves.find((k) => /^id_cadastro$/i.test(k)) ??
    null
  );
}

/** Converte uma linha do grid de dados bancários. */
export function mapLinhaDadosBancarios(
  raw: Record<string, unknown>,
): DadosBancariosFornecedor {
  return {
    banco: primeiroCampo(raw, CAMPOS_BANCO),
    agencia: primeiroCampo(raw, CAMPOS_AGENCIA),
    conta: primeiroCampo(raw, CAMPOS_CONTA),
    chavePix: primeiroCampo(raw, CAMPOS_PIX) ?? pixPorNomeDeCampo(raw),
  };
}

export interface DadosBancariosFornecedor {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
}

/**
 * Consolida as linhas do grid de um fornecedor: prioriza a que tem PIX e
 * completa os campos que faltarem com as demais.
 */
export function consolidarDadosBancarios(
  linhas: Array<Record<string, unknown>>,
): DadosBancariosFornecedor {
  const mapeadas = linhas.map(mapLinhaDadosBancarios);
  const comPix = mapeadas.filter((l) => l.chavePix);
  const ordenadas = [...comPix, ...mapeadas.filter((l) => !l.chavePix)];

  const out: DadosBancariosFornecedor = {
    banco: null,
    agencia: null,
    conta: null,
    chavePix: null,
  };
  for (const linha of ordenadas) {
    out.banco ??= linha.banco;
    out.agencia ??= linha.agencia;
    out.conta ??= linha.conta;
    out.chavePix ??= linha.chavePix;
  }
  return out;
}

function primeiroCampo(
  raw: Record<string, unknown>,
  candidatos: string[],
): string | null {
  const porNome = new Map(
    Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const nome of candidatos) {
    const valor = textoOuNull(porNome.get(nome));
    if (valor) return valor;
  }
  return null;
}

/** Último recurso: qualquer coluna com "pix" no nome e valor preenchido. */
function pixPorNomeDeCampo(raw: Record<string, unknown>): string | null {
  for (const [chave, valor] of Object.entries(raw)) {
    if (!/pix/i.test(chave)) continue;
    const s = textoOuNull(valor);
    if (s) return s;
  }
  return null;
}

/** Projeção local usada para decidir o que atualizar. */
export interface FuncionarioLocal {
  id: string;
  ixcId: number | null;
  nome: string;
  cpfCnpj: string | null;
  email: string | null;
  telefone: string | null;
  cidadeIxc: number | null;
  idFornecedorIxc: number | null;
}

/**
 * Monta o update de um funcionário já cadastrado a partir do fornecedor.
 *
 * - Dados bancários/PIX: o fornecedor é a fonte — sobrescreve o que vier
 *   preenchido e preserva o local quando o IXC não informa.
 * - Cadastro (nome/e-mail/telefone): só completa o que está vazio, exceto para
 *   quem veio do próprio fornecedor (`ixcId` nulo), onde o fornecedor manda.
 * - Nunca reativa nem desativa: o vínculo com a folha é decisão do usuário.
 */
export function montarUpdateDoFornecedor(
  local: FuncionarioLocal,
  dados: FuncionarioDoFornecedor,
): Prisma.FuncionarioUpdateInput {
  const data: Prisma.FuncionarioUpdateInput = {};

  if (local.idFornecedorIxc !== dados.idFornecedor) {
    data.idFornecedorIxc = dados.idFornecedor;
  }

  if (dados.banco) data.banco = dados.banco;
  if (dados.agencia) data.agencia = dados.agencia;
  if (dados.conta) data.conta = dados.conta;
  if (dados.chavePix) data.chavePix = dados.chavePix;

  const doFornecedor = local.ixcId === null;
  if (dados.nome && (doFornecedor || vazio(local.nome))) data.nome = dados.nome;
  if (dados.cpfCnpj && vazio(local.cpfCnpj)) data.cpfCnpj = dados.cpfCnpj;
  if (dados.email && (doFornecedor || vazio(local.email))) {
    data.email = dados.email;
  }
  if (dados.telefone && (doFornecedor || vazio(local.telefone))) {
    data.telefone = dados.telefone;
  }
  if (dados.cidadeIxc && local.cidadeIxc === null) {
    data.cidadeIxc = dados.cidadeIxc;
  }

  return data;
}

function textoOuNull(valor: unknown): string | null {
  const s = String(valor ?? '').trim();
  return s ? s : null;
}

function vazio(valor: string | null): boolean {
  return !valor || valor.trim() === '';
}
