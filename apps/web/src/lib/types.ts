export interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: 'ADMIN' | 'RH' | 'VISUALIZADOR';
}

export interface Funcionario {
  id: string;
  ixcId: number | null;
  nome: string;
  cpfCnpj: string | null;
  email: string | null;
  telefone: string | null;
  salarioBase: string;
  funcao: string | null;
  departamento: string | null;
  dataAdmissao: string | null;
  dataDemissao: string | null;
  ativo: boolean;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  observacoes: string | null;
  ultimoSyncAt: string | null;
}

export interface Adiantamento {
  id: string;
  descricao: string;
  data: string;
  valor: string;
  tipoPagamento: string;
}

export interface Funcionario {
  carteiraAssinada?: boolean;
  recebeAdiantamento?: boolean;
  idFornecedorIxc?: number | null;
}

export type TipoLancamento =
  | 'SALARIO'
  | 'ADIANTAMENTO'
  | 'BONUS'
  | 'DESCONTO'
  | 'AVULSO';

export interface Lancamento {
  id: string;
  tipo: TipoLancamento;
  descricao: string;
  valor: string;
  ativo: boolean;
  /** null = fixo (todo mês); "AAAA-MM" = avulso daquela competência */
  competencia: string | null;
}

export interface FuncionarioDetalhe extends Funcionario {
  adiantamentos: Adiantamento[];
  lancamentos: Lancamento[];
}

export type StatusContaPagar =
  | 'RASCUNHO'
  | 'AGUARDANDO_APROVACAO'
  | 'APROVADO'
  | 'REPROVADO'
  | 'AGUARDANDO_PAGAMENTO'
  | 'PAGO'
  | 'CANCELADO'
  | 'ERRO';

export interface ContaPagar {
  id: string;
  competencia: string | null;
  tipo: TipoLancamento;
  funcionarioId: string | null;
  beneficiarioNome: string;
  idFornecedorIxc: number | null;
  valor: string;
  contaContabil: number;
  contaPagamento: number;
  filialId: number;
  dataEmissao: string;
  dataVencimento: string;
  observacao: string;
  status: StatusContaPagar;
  erro: string | null;
  idFnApagarIxc: number | null;
  aprovadoEm: string | null;
  pagoEm: string | null;
  createdAt: string;
}

export interface LancamentoCalculado {
  tipo: TipoLancamento;
  valor: number;
  contaContabil: number;
  observacao: string;
}

export interface PreviewFuncionario {
  funcionarioId: string;
  nome: string;
  carteiraAssinada: boolean;
  recebeAdiantamento: boolean;
  lancamentos: LancamentoCalculado[];
}

export interface ConfigFinanceira {
  contaPagamentoId: number;
  filialId: number;
  contaContabilSalario: number;
  contaContabilAdiantamento: number;
  contaContabilBonus: number;
  cidadePadraoId: number;
  tipoPagamentoPadrao: string;
  obsSalarioTemplate: string;
  obsAdiantamentoTemplate: string;
  obsBonusTemplate: string;
  /** Campo do "Contribuinte ICMS" no fornecedor ("" = detectar automaticamente) */
  fornecedorCampoIcms: string;
  /** Valores desse campo que significam "Isento", separados por vírgula */
  fornecedorIcmsIsento: string;
}

export interface BeneficiarioAvulso {
  id: string;
  nome: string;
  cpfCnpj: string | null;
}

export interface Paginado<T> {
  itens: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Resumo {
  total: number;
  ativos: number;
  inativos: number;
  folhaBaseMensal: string;
}

export interface SyncResult {
  recurso: string;
  totalLidos: number;
  totalNovos: number;
  totalAtualizados: number;
}

/** Funcionário identificado no cadastro de fornecedor do IXC. */
export interface FuncionarioDoFornecedor {
  idFornecedor: number;
  nome: string;
  cpfCnpj: string | null;
  email: string | null;
  telefone: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  icms: string;
  jaCadastrado: boolean;
}

export interface OcorrenciaIcms {
  valor: string;
  quantidade: number;
  exemplos: string[];
}

export interface PreviewFornecedores {
  campoIcms: string | null;
  valoresIsento: string[];
  totalFornecedoresAtivos: number;
  distribuicao: OcorrenciaIcms[];
  funcionarios: FuncionarioDoFornecedor[];
}
