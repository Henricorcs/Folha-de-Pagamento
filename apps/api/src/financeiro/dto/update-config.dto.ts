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
  @IsOptional() @IsString() obsSalarioTemplate?: string;
  @IsOptional() @IsString() obsAdiantamentoTemplate?: string;
  @IsOptional() @IsString() obsBonusTemplate?: string;
  // Filtro fornecedor → funcionário (vazio no campo = detecção automática)
  @IsOptional() @IsString() fornecedorCampoIcms?: string;
  @IsOptional() @IsString() fornecedorIcmsIsento?: string;
  @IsOptional() @IsString() fornecedorTabelaBanco?: string;
  // Caixa do pagamento em mãos (0 = procurar pelo nome; tabelas vazias =
  // descobrir sozinho)
  @IsOptional() @IsInt() @Min(0) caixaEmMaosId?: number;
  @IsOptional() @IsString() caixaEmMaosNome?: string;
  @IsOptional() @IsString() caixaTabelaContas?: string;
  @IsOptional() @IsString() caixaTabelaMovimento?: string;
}
