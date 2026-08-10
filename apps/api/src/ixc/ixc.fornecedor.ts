/**
 * Filtros que identificam pessoas dentro do cadastro de `fornecedor` do IXC.
 *
 * Duas regras do usuário, com a mesma mecânica:
 * - **"Contribuinte ICMS" = Isento** → é **funcionário** (entra na folha);
 * - **"Tipo de pessoa" = Estrangeiro** → é **diarista** (recebe por diária).
 *
 * O cadastro de fornecedor é onde ficam, de fato, os dados bancários e a chave
 * PIX usados no pagamento — por isso ele é a fonte tanto das listas quanto dos
 * dados de pagamento.
 *
 * Em nenhum dos dois casos o nome da coluna nem o código do valor são chutados
 * às cegas: a coluna é detectada pelo nome, os valores aceitos são
 * parametrizáveis, e `distribuicaoDoCampo` existe para diagnosticar a base
 * real quando o filtro vier vazio.
 */
import { Prisma } from '@prisma/client';
import { normalizarTipoChavePix, type TipoChavePix } from './ixc.financeiro';
import { extrairDadosBancarios } from './ixc.mappers';
import { parseIxcId } from './ixc.parse';
import type { IxcFornecedor } from './ixc.types';

/**
 * Como reconhecer uma dessas regras numa base qualquer do IXC. Existe porque os
 * nomes de coluna e os códigos mudam de instalação para instalação.
 */
export interface RegraFornecedor {
  /** Colunas candidatas quando a configuração não diz qual usar. */
  busca: RegExp;
  /** Desempate entre as candidatas, na ordem. */
  preferencias: RegExp[];
  /** Texto inequívoco: casa mesmo fora dos valores configurados. */
  marca: RegExp;
  /** Valores aceitos quando a configuração vem vazia. */
  padrao: string[];
}

/** Fornecedor isento de ICMS é funcionário. */
export const REGRA_ICMS_ISENTO: RegraFornecedor = {
  busca: /icms/i,
  preferencias: [/contribu/i, /^icms$/i],
  marca: /ISENT/,
  padrao: ['I', 'ISENTO'],
};

/**
 * Fornecedor com tipo de pessoa "Estrangeiro" é diarista.
 *
 * A busca inclui `estrang` de propósito: se esta base guardar a marcação numa
 * coluna própria (e não como terceiro valor de `tipo_pessoa`), é assim que ela
 * é encontrada. O código real de "Estrangeiro" não está documentado — o padrão
 * abaixo é a aposta, e o preview mostra a distribuição verdadeira da base.
 */
export const REGRA_ESTRANGEIRO: RegraFornecedor = {
  busca: /estrang|pessoa/i,
  preferencias: [/^tipo_pessoa$/i, /estrang/i],
  marca: /ESTRANG/,
  padrao: ['E', 'ESTRANGEIRO'],
};

/** Dados de uma pessoa extraídos do cadastro de fornecedor. */
export interface PessoaDoFornecedor {
  idFornecedor: number;
  /** Razão social — é o nome que vai para a conta a pagar no IXC. */
  nome: string;
  /** Como a pessoa é conhecida no dia a dia ("Deda pedreiro"). */
  nomeFantasia: string | null;
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
  /** Valor cru do campo que fez o registro entrar no filtro. */
  valorFiltro: string;
}

/**
 * Descobre qual coluna do fornecedor guarda o valor da regra. Entre as
 * candidatas, as preferências desempatam na ordem em que vêm.
 */
export function detectarCampo(
  registros: Array<Record<string, unknown>>,
  regra: RegraFornecedor,
): string | null {
  for (const raw of registros) {
    const candidatos = Object.keys(raw).filter((k) => regra.busca.test(k));
    if (candidatos.length === 0) continue;
    for (const preferencia of regra.preferencias) {
      const escolhido = candidatos.find((k) => preferencia.test(k));
      if (escolhido) return escolhido;
    }
    return candidatos[0];
  }
  return null;
}

/** Valor normalizado (maiúsculas, sem espaços) de um campo do fornecedor. */
export function lerCampo(
  raw: Record<string, unknown>,
  campo: string | null,
): string {
  if (!campo) return '';
  return String(raw[campo] ?? '').trim().toUpperCase();
}

/**
 * Converte a lista configurada ("I, ISENTO, 2") em valores comparáveis.
 * Vazio cai no padrão da regra.
 */
export function parseValores(
  config: string | null | undefined,
  regra: RegraFornecedor,
): string[] {
  const itens = String(config ?? '')
    .split(/[,;\s]+/)
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
  return itens.length > 0 ? itens : [...regra.padrao];
}

/** true quando o valor lido satisfaz a regra. */
export function casaValor(
  valor: string,
  valores: string[],
  regra: RegraFornecedor,
): boolean {
  const v = valor.trim().toUpperCase();
  if (!v) return false;
  // Texto por extenso é inequívoco ("ISENTO", "ESTRANGEIRO"): vale sempre.
  if (regra.marca.test(v)) return true;
  return valores.includes(v);
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

/** Converte um fornecedor cru em dados de pessoa (null se id inválido). */
export function mapFornecedorParaPessoa(
  raw: IxcFornecedor,
  valorFiltro = '',
): PessoaDoFornecedor | null {
  const idFornecedor = parseIxcId(raw.id);
  if (idFornecedor === null) return null;

  const bancarios = extrairDadosBancarios(raw);
  return {
    idFornecedor,
    nome: nomeFornecedor(raw) || `Fornecedor ${idFornecedor}`,
    nomeFantasia: textoOuNull(raw.fantasia),
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
    valorFiltro,
  };
}

/**
 * Aplica uma regra sobre os fornecedores lidos do IXC e devolve quem casou,
 * junto do campo efetivamente usado.
 */
export function filtrarFornecedores(
  registros: IxcFornecedor[],
  regra: RegraFornecedor,
  opts: { campo?: string | null; valores?: string[] } = {},
): { campo: string | null; pessoas: PessoaDoFornecedor[] } {
  const campo = opts.campo?.trim() || detectarCampo(registros, regra);
  if (!campo) return { campo: null, pessoas: [] };

  const valores = opts.valores?.length
    ? opts.valores.map((v) => v.trim().toUpperCase())
    : [...regra.padrao];

  const pessoas: PessoaDoFornecedor[] = [];
  for (const raw of registros) {
    const valor = lerCampo(raw, campo);
    if (!casaValor(valor, valores, regra)) continue;
    const mapeado = mapFornecedorParaPessoa(raw, valor);
    if (mapeado) pessoas.push(mapeado);
  }
  return { campo, pessoas };
}

/** Um valor distinto do campo filtrado e quantos fornecedores o usam. */
export interface OcorrenciaCampo {
  valor: string;
  quantidade: number;
  exemplos: string[];
}

/**
 * Distribuição dos valores de um campo na base — é o que permite confirmar
 * qual código significa "Isento" (ou "Estrangeiro") sem adivinhação.
 */
export function distribuicaoDoCampo(
  registros: IxcFornecedor[],
  campo: string | null,
  maxExemplos = 3,
): OcorrenciaCampo[] {
  const mapa = new Map<string, OcorrenciaCampo>();
  for (const raw of registros) {
    const valor = lerCampo(raw, campo) || '(vazio)';
    const atual: OcorrenciaCampo = mapa.get(valor) ?? {
      valor,
      quantidade: 0,
      exemplos: [],
    };
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

/** O mínimo para casar um cadastro local com um fornecedor do IXC. */
export interface VinculoLocal {
  id: string;
  cpfCnpj: string | null;
  idFornecedorIxc: number | null;
}

/** Projeção local usada para decidir o que atualizar. */
export interface FuncionarioLocal extends VinculoLocal {
  ixcId: number | null;
  nome: string;
  email: string | null;
  telefone: string | null;
  cidadeIxc: number | null;
}

/** Projeção local do diarista usada para decidir o que atualizar. */
export interface DiaristaLocal extends VinculoLocal {
  nome: string;
  nomeFantasia: string | null;
  telefone: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  cidadeIxc: number | null;
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
  dados: PessoaDoFornecedor,
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

/**
 * Monta o update de um diarista já cadastrado a partir do fornecedor.
 *
 * Ao contrário do funcionário, aqui **o que está escrito localmente vence**:
 * a importação só completa campo vazio. Quem corrige a chave PIX na tela
 * (porque o IXC está desatualizado) não pode ver a correção desfeita na
 * sincronização seguinte.
 *
 * O vínculo com o fornecedor só é gravado quando ainda não existe: sobrescrevê-lo
 * por casamento de CPF faria o vínculo oscilar a cada rodada quando dois
 * fornecedores compartilham o mesmo documento — e é ele que decide contra qual
 * cadastro do IXC as próximas contas a pagar são lançadas.
 */
export function montarUpdateDiaristaDoFornecedor(
  local: DiaristaLocal,
  dados: PessoaDoFornecedor,
): Prisma.DiaristaUpdateInput {
  const data: Prisma.DiaristaUpdateInput = {};

  if (local.idFornecedorIxc === null) {
    data.idFornecedorIxc = dados.idFornecedor;
  }

  if (dados.nome && vazio(local.nome)) data.nome = dados.nome;
  if (dados.nomeFantasia && vazio(local.nomeFantasia)) {
    data.nomeFantasia = dados.nomeFantasia;
  }
  if (dados.cpfCnpj && vazio(local.cpfCnpj)) data.cpfCnpj = dados.cpfCnpj;
  if (dados.telefone && vazio(local.telefone)) data.telefone = dados.telefone;
  if (dados.banco && vazio(local.banco)) data.banco = dados.banco;
  if (dados.agencia && vazio(local.agencia)) data.agencia = dados.agencia;
  if (dados.conta && vazio(local.conta)) data.conta = dados.conta;
  // Chave e tipo andam juntos: são a mesma decisão de pagamento.
  if (dados.chavePix && vazio(local.chavePix)) {
    data.chavePix = dados.chavePix;
    data.tipoChavePix = dados.tipoChavePix;
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
