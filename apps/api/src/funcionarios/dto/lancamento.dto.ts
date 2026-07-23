import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { TipoLancamento } from '@prisma/client';

export class LancamentoDto {
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

  /** Vazio = fixo (todo mês); "AAAA-MM" = avulso daquela competência. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'competencia deve estar no formato AAAA-MM' })
  competencia?: string;
}
