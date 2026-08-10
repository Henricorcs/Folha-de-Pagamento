export type PerfilUsuario = 'ADMIN' | 'RH' | 'VISUALIZADOR';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: PerfilUsuario;
}

/** Login como aparece na tela de gerenciamento (só para ADMIN). */
export interface UsuarioAdmin extends Usuario {
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
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
  /** Tipo de PIX preferencial do fornecedor, repetido na conta a pagar */
  tipoChavePix: string | null;
  observacoes: string | null;
  ultimoSyncAt: string | null;
}

/** Tipos de chave PIX, como aparecem na tela de contas a pagar do IXC. */
export const TIPOS_CHAVE_PIX = [
  'CPF/CNPJ',
  'Celular',
  'E-mail',
  'Aleatória',
  'Código copia e cola',
] as const;

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
  /** Só para carteira assinada: o que a folha daqui paga (vira a base) */
  valorAReceberFolha?: string | null;
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
  | 'AVULSO'
  | 'DIARIA';

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

/** O que a conferência com o IXC descobriu sobre uma conta. */
export interface ResultadoSincronizacao {
  /** null = não existe mais no IXC e foi apagada daqui também. */
  conta: ContaPagar | null;
  removida: boolean;
  mudouStatus: boolean;
  statusAnterior: StatusContaPagar;
}

export interface ResumoSincronizacao {
  verificadas: number;
  pagas: number;
  removidas: number;
  atualizadas: number;
  erros: number;
}

/** Conta que ficou de fora de uma ação em massa, e por quê. */
export interface FalhaLote {
  id: string;
  beneficiario: string;
  erro: string;
}

/** O que aconteceu numa ação feita em várias contas de uma vez. */
export interface ResultadoLote {
  total: number;
  sucesso: number;
  falhas: FalhaLote[];
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
  /** Base usada: salário base ou "a receber na folha" (carteira assinada) */
  salarioBase: number;
  usouValorAReceber: boolean;
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
  /** Conta de bônus que já existe nesta competência */
  bonusJaGerado: ContaJaGerada | null;
  lancamentos: LancamentoCalculado[];
}

export interface ConfigFinanceira {
  contaPagamentoId: number;
  filialId: number;
  contaContabilSalario: number;
  contaContabilAdiantamento: number;
  contaContabilBonus: number;
  contaContabilDiaria: number;
  cidadePadraoId: number;
  /** % do salário base no adiantamento do dia 25 (padrão 40) */
  percentualAdiantamento: number;
  tipoPagamentoPadrao: string;
  /** Coluna do fn_apagar com o "Tipo da chave Pix" ("" = aprender do IXC) */
  pixCampoTipoChave: string;
  /** Códigos por tipo, ex.: "Celular=C,E-mail=E" ("" = usar o rótulo) */
  pixCodigosTipoChave: string;
  /** Coluna que o app aprendeu sozinho do IXC (só leitura) */
  pixCampoTipoChaveAprendido: string;
  /** Códigos que o app já decorou, um por tipo de chave (só leitura) */
  pixCodigosTipoChaveAprendidos: string;
  obsSalarioTemplate: string;
  obsAdiantamentoTemplate: string;
  obsBonusTemplate: string;
  /** Campo do "Contribuinte ICMS" no fornecedor ("" = detectar automaticamente) */
  fornecedorCampoIcms: string;
  /** Valores desse campo que significam "Isento", separados por vírgula */
  fornecedorIcmsIsento: string;
  /** Tabela da aba "Dados bancários" do fornecedor ("" = descobrir sozinho) */
  fornecedorTabelaBanco: string;
  /** Campo do "Tipo de pessoa" no fornecedor ("" = detectar automaticamente) */
  fornecedorCampoTipoPessoa: string;
  /** Valores desse campo que significam "Estrangeiro", separados por vírgula */
  fornecedorTipoEstrangeiro: string;
  /** Caixa de onde sai o dinheiro pago em mãos (0 = procurar pelo nome) */
  caixaEmMaosId: number;
  caixaEmMaosNome: string;
  /** Tabelas do IXC ("" = descobrir sozinho) */
  caixaTabelaContas: string;
  caixaTabelaMovimento: string;
}

export interface BeneficiarioAvulso {
  id: string;
  nome: string;
  cpfCnpj: string | null;
}

// --- Diaristas: quem trabalha por dia e recebe por diária ---
/** IXC = conta a pagar (banco). EM_MAOS = dinheiro, sai do caixa. */
export type FormaPagamentoDiaria = 'IXC' | 'EM_MAOS';

export interface Diarista {
  id: string;
  /** Razão social — é o nome que vai para a conta a pagar no IXC */
  nome: string;
  /** Como a pessoa é conhecida ("Deda pedreiro"); também é buscável */
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  telefone: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  tipoChavePix: string | null;
  valorDiaria: string | null;
  formaPagamento: FormaPagamentoDiaria;
  observacoes: string | null;
  ativo: boolean;
  idFornecedorIxc: number | null;
  /** Veio da importação de fornecedores "Estrangeiro", não do cadastro à mão */
  importadoDoIxc: boolean;
}

export interface DiaristaComResumo {
  diarista: Diarista;
  /** Diárias no histórico, pagas ou não */
  quantidadeDiarias: number;
  /** Só o dinheiro que saiu: em mãos, ou conta a pagar já PAGA */
  totalPago: number;
  quantidadePagas: number;
  /** No IXC, ainda a caminho do banco */
  totalAguardando: number;
  quantidadeAguardando: number;
  /** Contas a pagar recusadas pelo IXC */
  quantidadeComErro: number;
  ultimaDiaria: string | null;
  /** Diárias em mãos que ainda não viraram lançamento no caixa do IXC */
  pendentesNoCaixa: number;
}

export interface Diaria {
  id: string;
  diaristaId: string;
  data: string;
  quantidade: string;
  valorDiaria: string;
  valor: string;
  descricao: string;
  forma: FormaPagamentoDiaria;
  contaPagarId: string | null;
  /** Caixa do IXC de onde o dinheiro saiu (pagamento em mãos) */
  caixaIxc: number | null;
  /** Lançamento criado na movimentação financeira do IXC */
  idLancamentoIxc: number | null;
  lancadoEm: string | null;
  /** Alguém lançou no IXC à mão */
  lancadoManual: boolean;
  /** Por que a saída no caixa não saiu (null = sem pendência) */
  erroIxc: string | null;
  diarista?: { nome: string };
  contaPagar?: {
    id: string;
    status: StatusContaPagar;
    erro: string | null;
    idFnApagarIxc: number | null;
  } | null;
}

/** Um caixa/conta do IXC, para configurar de onde sai o dinheiro em mãos. */
export interface CaixaIxc {
  id: number;
  nome: string;
  tipo: string | null;
}

export interface CaixasIxc {
  /** Tabela do IXC que respondeu (null = nenhuma encontrada) */
  tabela: string | null;
  caixas: CaixaIxc[];
  /** Código que está valendo hoje para o pagamento em mãos */
  emUso: number | null;
  nomeProcurado: string;
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

/** Pessoa identificada no cadastro de fornecedor do IXC. */
export interface PessoaDoFornecedor {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  email: string | null;
  telefone: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  tipoChavePix: string | null;
  /** Valor cru do campo que fez o registro entrar no filtro */
  valorFiltro: string;
  jaCadastrado: boolean;
}

export interface OcorrenciaCampo {
  valor: string;
  quantidade: number;
  exemplos: string[];
}

export interface PreviewFornecedores {
  campoIcms: string | null;
  valoresIsento: string[];
  tabelaBanco: string | null;
  totalFornecedoresAtivos: number;
  distribuicao: OcorrenciaCampo[];
  funcionarios: PessoaDoFornecedor[];
}

/** Resultado da importação de diaristas do cadastro de fornecedor. */
export interface SyncDiaristasResult extends SyncResult {
  campoTipoPessoa: string | null;
  /** Quem não entrou porque já está cadastrado como funcionário */
  ignoradosPorSerFuncionario: string[];
}

export interface PreviewDiaristas {
  campoTipoPessoa: string | null;
  valoresEstrangeiro: string[];
  tabelaBanco: string | null;
  totalFornecedoresAtivos: number;
  distribuicao: OcorrenciaCampo[];
  camposDisponiveis: string[];
  diaristas: Array<PessoaDoFornecedor & { jaEhFuncionario: boolean }>;
}
