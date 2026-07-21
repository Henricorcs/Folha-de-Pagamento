import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateConfigFinanceiraDto {
  @IsOptional() @IsInt() @Min(1) contaPagamentoId?: number;
  @IsOptional() @IsInt() @Min(1) filialId?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilSalario?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilAdiantamento?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilBonus?: number;
  @IsOptional() @IsInt() @Min(1) cidadePadraoId?: number;
  @IsOptional() @IsString() obsSalarioTemplate?: string;
  @IsOptional() @IsString() obsAdiantamentoTemplate?: string;
  @IsOptional() @IsString() obsBonusTemplate?: string;
}
