import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { TipoLancamento } from '@prisma/client';

export class LancamentoFixoDto {
  @IsEnum(TipoLancamento)
  tipo!: TipoLancamento; // ADIANTAMENTO | DESCONTO | BONUS

  @IsString()
  @MinLength(2)
  descricao!: string;

  @IsNumber()
  @Min(0)
  valor!: number;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
