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
import { normalizarTipoChavePix, type TipoChavePix } from './ixc.financeiro';
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
  /** Tipo da chave acima, para a conta a pagar marcar o mesmo do cadastro. */
  tipoChavePix: TipoChavePix | null;
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
    // Chave e tipo saem juntos, da mesma coluna. O grid de dados bancários
    // sobrescreve isso depois (é lá que a chave de verdade mora).
    ...escolherPix(raw),
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
/**
 * Colunas de chave PIX, na ordem de preferência de quando o cadastro não diz
 * qual é a preferencial. O nome da coluna já entrega o tipo da chave — e é o
 * tipo que a tela de contas a pagar do IXC precisa ter marcado. `null` = coluna
 * genérica, aí o tipo sai do formato da chave.
 */
const COLUNAS_PIX: Array<{ campos: string[]; tipo: TipoChavePix | null }> = [
  { campos: ['chave_pix'], tipo: null },
  { campos: ['pix_cpf_cnpj', 'pix_cnpj_cpf', 'pix_cpf', 'pix_cnpj'], tipo: 'CPF/CNPJ' },
  { campos: ['pix_email', 'pix_e_mail'], tipo: 'E-mail' },
  { campos: ['pix_celular', 'pix_telefone', 'pix_fone'], tipo: 'Celular' },
  { campos: ['pix_aleatoria', 'pix_chave_aleatoria'], tipo: 'Aleatória' },
  { campos: ['pix'], tipo: null },
];

/**
 * Colunas prováveis do "tipo de PIX preferencial" do fornecedor. Como o nome
 * varia entre bases, o último recurso é qualquer coluna que fale de PIX e de
 * tipo/preferência.
 */
const CAMPOS_TIPO_PIX = [
  'tipo_pix_preferencial',
  'pix_preferencial',
  'tipo_chave_pix',
  'tipo_pix',
  'chave_pix_preferencial',
  'preferencia_pix',
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
    ...escolherPix(raw),
  };
}

/** Nome da coluna do "tipo de PIX preferencial" nesta linha, se houver. */
export function detectarCampoTipoPix(
  raw: Record<string, unknown>,
): string | null {
  const porNome = new Map(
    Object.keys(raw).map((k) => [k.toLowerCase(), k] as const),
  );
  for (const nome of CAMPOS_TIPO_PIX) {
    const original = porNome.get(nome);
    if (original) return original;
  }
  return (
    Object.keys(raw).find((k) => /pix/i.test(k) && /tipo|prefer/i.test(k)) ??
    null
  );
}

/** Tipo de PIX preferencial do cadastro (null = a base não informa). */
export function lerTipoPixPreferencial(
  raw: Record<string, unknown>,
): TipoChavePix | null {
  const campo = detectarCampoTipoPix(raw);
  return campo ? normalizarTipoChavePix(raw[campo]) : null;
}

/**
 * Chave PIX e o tipo que vai marcado com ela na conta a pagar.
 *
 * Manda o "tipo de PIX preferencial" do cadastro — é o que o fornecedor tem
 * escolhido no IXC. Se a coluna daquele tipo estiver vazia, cai na primeira
 * chave preenchida: chave e tipo saem **sempre da mesma coluna**, porque
 * mandar um tipo que não é o da chave faz o banco recusar o pagamento.
 */
export function escolherPix(raw: Record<string, unknown>): {
  chavePix: string | null;
  tipoChavePix: TipoChavePix | null;
} {
  const preferido = lerTipoPixPreferencial(raw);
  if (preferido) {
    const grupo = COLUNAS_PIX.find((c) => c.tipo === preferido);
    const chave = grupo ? primeiroCampo(raw, grupo.campos) : null;
    if (chave) return { chavePix: chave, tipoChavePix: preferido };
  }

  for (const coluna of COLUNAS_PIX) {
    const chave = primeiroCampo(raw, coluna.campos);
    if (chave) return { chavePix: chave, tipoChavePix: coluna.tipo };
  }
  return pixPorNomeDeCampo(raw);
}

export interface DadosBancariosFornecedor {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  /** Tipo preferencial do cadastro; null = deduzir pelo formato da chave. */
  tipoChavePix: TipoChavePix | null;
}

/**
 * Consolida as linhas do grid de um fornecedor: prioriza a que tem PIX e
 * completa os campos que faltarem com as demais. Chave e tipo vêm sempre da
 * mesma linha — misturar as duas coisas seria pagar com o tipo errado.
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
    tipoChavePix: null,
  };
  for (const linha of ordenadas) {
    out.banco ??= linha.banco;
    out.agencia ??= linha.agencia;
    out.conta ??= linha.conta;
    if (!out.chavePix && linha.chavePix) {
      out.chavePix = linha.chavePix;
      out.tipoChavePix = linha.tipoChavePix;
    }
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

/**
 * Último recurso: qualquer coluna com "pix" no nome e valor preenchido, com o
 * tipo tirado do próprio nome da coluna. A coluna do tipo preferencial fica de
 * fora — o conteúdo dela é "Celular", não uma chave.
 */
function pixPorNomeDeCampo(raw: Record<string, unknown>): {
  chavePix: string | null;
  tipoChavePix: TipoChavePix | null;
} {
  const campoTipo = detectarCampoTipoPix(raw);
  for (const [chave, valor] of Object.entries(raw)) {
    if (!/pix/i.test(chave) || chave === campoTipo) continue;
    const s = textoOuNull(valor);
    if (s) return { chavePix: s, tipoChavePix: normalizarTipoChavePix(chave) };
  }
  return { chavePix: null, tipoChavePix: null };
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
  // O tipo viaja junto com a chave: guardar o tipo antigo com uma chave nova
  // (o fornecedor trocou de celular para e-mail) faria o banco recusar.
  if (dados.chavePix) {
    data.chavePix = dados.chavePix;
    data.tipoChavePix = dados.tipoChavePix;
  }

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
