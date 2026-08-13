import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { StatusContaPagar, TipoLancamento } from '@prisma/client';

export class QueryContasPagarDto {
  @IsOptional() @IsEnum(StatusContaPagar) status?: StatusContaPagar;
  @IsOptional() @IsEnum(TipoLancamento) tipo?: TipoLancamento;
  @IsOptional() @IsString() funcionarioId?: string;

  /** Nome, apelido ou CPF/CNPJ de quem recebeu — funcionário, diarista ou avulso. */
  @IsOptional() @IsString() busca?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  competencia?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 50;
}

export class AuditoriaDto {
  @IsString()
  motivo!: string;
}

/**
 * Mesma ação em várias contas de uma vez. O limite existe porque cada conta é
 * uma ida ao IXC — lote grande demais estoura o tempo da requisição.
 */
export class LoteContasDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];

  /** Motivo da auditoria; ignorado na exclusão. */
  @IsOptional() @IsString() motivo?: string;
}
