import { Transform } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryFuncionariosDto {
  @IsOptional()
  @IsString()
  busca?: string;

  /** "true" | "false" — filtra por ativo */
  @IsOptional()
  @IsBooleanString()
  ativo?: string;

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
  pageSize = 25;
}
