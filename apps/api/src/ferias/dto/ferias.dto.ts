import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Uma pessoa da previsão, como a tela confirmou. */
export class ItemPrevisaoDto {
  @IsInt() @Min(1) ordem!: number;

  @IsString() @MinLength(1) codigo!: string;
  @IsString() @MinLength(2) nome!: string;
  @IsOptional() @IsString() cargo?: string | null;

  @IsOptional() @IsISO8601() admissao?: string | null;

  @IsISO8601() periodoInicio!: string;
  @IsISO8601() periodoFim!: string;
  @IsISO8601() dataLimite!: string;

  @IsNumber() @Min(0) @Max(60) diasDireito!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(60) diasAcumulados?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(60) diasRestantes?: number | null;
}

/** A previsão inteira, conferida na tela e pronta para substituir a anterior. */
export class GravarPrevisaoDto {
  @IsISO8601() dataRelatorio!: string;

  @IsOptional() @IsString() empresa?: string | null;
  @IsOptional() @IsString() cnpj?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(12) mesesLimite?: number | null;

  @IsString() @MinLength(1) arquivoNome!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemPrevisaoDto)
  itens!: ItemPrevisaoDto[];
}

/** "Mandar para férias": quem sai, quando e por quantos dias. */
export class MarcarFeriasDto {
  /** Item da previsão de quem vai sair. */
  @IsString() @MinLength(1) itemId!: string;

  /** Primeiro dia de férias. */
  @IsISO8601() inicio!: string;

  /**
   * Dias de férias. O normal são 30; menos vale para quem vende dias (abono) ou
   * divide em períodos, que a lei permite desde 2017.
   */
  @IsInt() @Min(1) @Max(30) dias!: number;

  @IsOptional() @IsString() observacao?: string;
}
