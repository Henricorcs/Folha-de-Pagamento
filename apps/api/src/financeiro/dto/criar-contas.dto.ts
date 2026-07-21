import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { TipoLancamento } from '@prisma/client';

export class ItemContaPagarDto {
  @IsOptional() @IsString() funcionarioId?: string;
  @IsOptional() @IsString() beneficiarioAvulsoId?: string;

  @IsEnum(TipoLancamento)
  tipo!: TipoLancamento;

  @IsNumber() @Min(0.01) valor!: number;

  /** Conta contábil (id_conta). Se omitida, usa o padrão por tipo. */
  @IsOptional() @IsInt() @Min(1) contaContabil?: number;

  @IsOptional() @IsString() observacao?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'competencia deve estar no formato AAAA-MM' })
  competencia?: string;
}

export class CriarContasPagarDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemContaPagarDto)
  itens!: ItemContaPagarDto[];
}
