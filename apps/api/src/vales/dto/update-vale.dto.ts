import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * O que dá para mexer depois de criado. Valor e parcelas não mudam — o carnê
 * já existe; para corrigir, cancele e crie de novo.
 */
export class UpdateValeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  descricao?: string;

  @IsOptional()
  @IsBoolean()
  descontarDaFolha?: boolean;

  @IsOptional()
  @IsBoolean()
  cancelado?: boolean;

  @IsOptional()
  @IsString()
  observacao?: string;
}
