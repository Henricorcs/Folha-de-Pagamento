import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { StatusContaPagar, TipoLancamento } from '@prisma/client';

export class QueryContasPagarDto {
  @IsOptional() @IsEnum(StatusContaPagar) status?: StatusContaPagar;
  @IsOptional() @IsEnum(TipoLancamento) tipo?: TipoLancamento;
  @IsOptional() @IsString() funcionarioId?: string;

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
