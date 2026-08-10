import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateConfigFinanceiraDto {
  @IsOptional() @IsInt() @Min(1) contaPagamentoId?: number;
  @IsOptional() @IsInt() @Min(1) filialId?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilSalario?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilAdiantamento?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilBonus?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilDiaria?: number;
  @IsOptional() @IsInt() @Min(1) cidadePadraoId?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) percentualAdiantamento?: number;
  @IsOptional() @IsString() tipoPagamentoPadrao?: string;
  // Rádio "Tipo da chave Pix" do fn_apagar (vazio = aprender do próprio IXC)
  @IsOptional() @IsString() pixCampoTipoChave?: string;
  @IsOptional() @IsString() pixCodigosTipoChave?: string;
  @IsOptional() @IsString() obsSalarioTemplate?: string;
  @IsOptional() @IsString() obsAdiantamentoTemplate?: string;
  @IsOptional() @IsString() obsBonusTemplate?: string;
  // Filtro fornecedor → funcionário (vazio no campo = detecção automática)
  @IsOptional() @IsString() fornecedorCampoIcms?: string;
  @IsOptional() @IsString() fornecedorIcmsIsento?: string;
  @IsOptional() @IsString() fornecedorTabelaBanco?: string;
  // Filtro fornecedor → diarista (tipo de pessoa "Estrangeiro")
  @IsOptional() @IsString() fornecedorCampoTipoPessoa?: string;
  @IsOptional() @IsString() fornecedorTipoEstrangeiro?: string;
  // Caixa do pagamento em mãos (0 = procurar pelo nome; tabelas vazias =
  // descobrir sozinho)
  @IsOptional() @IsInt() @Min(0) caixaEmMaosId?: number;
  @IsOptional() @IsString() caixaEmMaosNome?: string;
  @IsOptional() @IsString() caixaTabelaContas?: string;
  @IsOptional() @IsString() caixaTabelaMovimento?: string;
}
