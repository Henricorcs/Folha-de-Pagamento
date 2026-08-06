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

  /**
   * "true" traz também quem não é fornecedor isento de ICMS. Por padrão a
   * listagem mostra só os funcionários (fornecedor ativo + ICMS isento).
   */
  @IsOptional()
  @IsBooleanString()
  todos?: string;

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
