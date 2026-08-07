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
  /** Contratado como CLT (informativo; a folha olha a carteira assinada) */
  clt?: boolean;
  carteiraAssinada?: boolean;
  recebeAdiantamento?: boolean;
  /** Valor que a pessoa recebe no dia 25 (null = percentual da configuração) */
  valorAdiantamento?: string | null;
  /** Quanto a pessoa ganha por venda — na prática R$ 5 ou R$ 50 */
  valorPorVenda?: string | null;
  idFornecedorIxc?: number | null;
}

/** Vendas e horas extras de um mês trabalhado. */
export interface VariavelMes {
  id: string;
  competencia: string;
  vendas: number;
  /** Valor por venda só daquele mês (null = o do cadastro) */
  valorPorVenda: string | null;
  horasExtras: string;
  observacao: string | null;
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
  variaveisMes: VariavelMes[];
}

// --- Vales e acertos entre a pessoa e a empresa (avulsos ou parcelados) ---
/** DESCONTO: o funcionário deve. CREDITO: a empresa deve. */
export type SentidoVale = 'DESCONTO' | 'CREDITO';

export interface ValeParcela {
  id: string;
  numero: number;
  competencia: string;
  valor: string;
  descontada: boolean;
  descontadaEm: string | null;
}

export interface Vale {
  id: string;
  funcionarioId: string;
  sentido: SentidoVale;
  descricao: string;
  data: string;
  valorTotal: string;
  quantidadeParcelas: number;
  valorParcela: string;
  descontarDaFolha: boolean;
  competenciaInicio: string;
  cancelado: boolean;
  observacao: string | null;
  parcelas: ValeParcela[];
}

export interface ValeComSaldo {
  vale: Vale;
  funcionarioNome: string;
  saldo: number;
  totalDescontado: number;
  parcelasDescontadas: number;
  quitado: boolean;
  proximaParcela: ValeParcela | null;
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

/** Situação do adiantamento do dia 25 na competência da prévia. */
export interface SituacaoAdiantamento {
  valor: number;
  /** Foi abatido do saldo salarial desta prévia? */
  descontado: boolean;
  situacao: 'PAGO' | 'PENDENTE' | 'NAO_GERADO';
  status: StatusContaPagar | null;
  pagoEm: string | null;
}

/** Saldo salarial aberto: o que entrou e o que saiu. */
export interface ComposicaoSalario {
  salarioBase: number;
  vendas: number;
  valorPorVenda: number;
  comissao: number;
  horasExtras: number;
  descontos: number;
  /** vales descontados (o funcionário devia à empresa) */
  vales: number;
  /** acertos somados (a empresa devia ao funcionário) */
  valesCredito: number;
  adiantamento: number;
  adiantamentoDescontado: number;
  saldo: number;
}

/** Parcela de vale/acerto que mexeu na folha da competência. */
export interface ParcelaValeFolha {
  valeId: string;
  sentido: SentidoVale;
  descricao: string;
  numero: number;
  de: number;
  valor: number;
  descontada: boolean;
}

/** Aviso de que aquele pagamento já existe na competência. */
export interface ContaJaGerada {
  situacao: 'PAGO' | 'PENDENTE';
  status: StatusContaPagar;
  pagoEm: string | null;
}

export interface PreviewFuncionario {
  funcionarioId: string;
  nome: string;
  carteiraAssinada: boolean;
  recebeAdiantamento: boolean;
  /** null para quem não recebe adiantamento no dia 25 */
  adiantamento: SituacaoAdiantamento | null;
  composicao: ComposicaoSalario;
  vales: ParcelaValeFolha[];
  /** Conta de salário que já existe nesta competência */
  salarioJaGerado: ContaJaGerada | null;
  lancamentos: LancamentoCalculado[];
}

export interface ConfigFinanceira {
  contaPagamentoId: number;
  filialId: number;
  contaContabilSalario: number;
  contaContabilAdiantamento: number;
  contaContabilBonus: number;
  cidadePadraoId: number;
  /** % do salário base no adiantamento do dia 25 (padrão 40) */
  percentualAdiantamento: number;
  tipoPagamentoPadrao: string;
  obsSalarioTemplate: string;
  obsAdiantamentoTemplate: string;
  obsBonusTemplate: string;
  /** Campo do "Contribuinte ICMS" no fornecedor ("" = detectar automaticamente) */
  fornecedorCampoIcms: string;
  /** Valores desse campo que significam "Isento", separados por vírgula */
  fornecedorIcmsIsento: string;
  /** Tabela da aba "Dados bancários" do fornecedor ("" = descobrir sozinho) */
  fornecedorTabelaBanco: string;
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
  salarioBaseMensal: string;
  /** Bônus fixos (todo mês) — já somados na folha base */
  bonusFixoMensal: string;
  folhaBaseMensal: string;
}

/** Números da tela inicial. */
export interface Dashboard {
  competencia: string;
  funcionarios: {
    total: number;
    ativos: number;
    inativos: number;
    salarioBaseMensal: number;
    bonusFixoMensal: number;
    folhaBaseMensal: number;
    semPix: number;
  };
  folha: {
    total: number;
    pago: number;
    emAberto: number;
    comErro: number;
    quantidade: number;
    porStatus: { status: StatusContaPagar; quantidade: number; valor: number }[];
    porTipo: { tipo: TipoLancamento; quantidade: number; valor: number }[];
  };
  vales: {
    valesEmAberto: number;
    /** o que os funcionários ainda devem à empresa */
    saldoDevedor: number;
    /** o que a empresa ainda deve aos funcionários */
    saldoAPagar: number;
    descontoNaCompetencia: number;
    creditoNaCompetencia: number;
  };
  serie: { competencia: string; total: number; pago: number }[];
  ultimasContas: ContaPagar[];
  ultimoSync: {
    recurso: string;
    status: 'EM_ANDAMENTO' | 'SUCESSO' | 'ERRO';
    totalLidos: number;
    iniciadoEm: string;
    concluidoEm: string | null;
  } | null;
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
  tabelaBanco: string | null;
  totalFornecedoresAtivos: number;
  distribuicao: OcorrenciaIcms[];
  funcionarios: FuncionarioDoFornecedor[];
}
