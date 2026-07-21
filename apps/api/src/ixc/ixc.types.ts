/** Operadores de comparação aceitos pelo webservice do IXC. */
export type IxcOper = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'L' | 'NL';

/** Parâmetros de uma listagem (header `ixcsoft: listar`). */
export interface IxcListParams {
  /** Campo usado no filtro, ex.: "funcionarios.id" */
  qtype: string;
  /** Valor comparado */
  query: string;
  /** Operador (default "=") */
  oper?: IxcOper;
  /** Página (1-based) */
  page?: number;
  /** Registros por página */
  rp?: number;
  /** Campo de ordenação (default = qtype) */
  sortname?: string;
  sortorder?: 'asc' | 'desc';
  /** Filtro avançado (grid_param) em JSON, quando necessário */
  gridParam?: unknown;
}

/** Resposta padrão de listagem do IXC. */
export interface IxcListResponse<T = Record<string, unknown>> {
  total: number;
  page: number;
  registros: T[];
}

/** Resposta de operações de escrita (insert/update) e endpoints de ação. */
export interface IxcActionResponse {
  type?: string; // "success" | "error"
  message?: string;
  id?: string | number;
  [key: string]: unknown;
}

/** Registro cru de `funcionarios` (campos relevantes; há muitos outros). */
export interface IxcFuncionario {
  id: string;
  funcionario: string;
  cpf_cnpj?: string;
  email?: string;
  fone_celular?: string;
  fone?: string;
  salario?: string;
  filial_id?: string;
  id_funcao?: string;
  id_departamento?: string;
  data_admissao?: string;
  data_demissao?: string;
  ativo?: string; // "S" | "N"
  banco?: string;
  agencia?: string;
  conta?: string;
  chave_pix?: string;
  [key: string]: unknown;
}

/** Registro cru de `fl_adto_salario` (adiantamentos). */
export interface IxcAdiantamento {
  id: string;
  id_funcionario: string;
  descricao?: string;
  data?: string;
  tipo_pagamento?: string; // "D" | "C" | ...
  valor?: string;
  documento?: string;
  conta_?: string;
  id_conta?: string;
  [key: string]: unknown;
}
