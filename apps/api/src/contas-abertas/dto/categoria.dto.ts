import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CriarCategoriaDto {
  @IsString() @MinLength(2) @MaxLength(60) nome!: string;
}

export class AtualizarCategoriaDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) nome?: string;
  @IsOptional() @IsBoolean() ativa?: boolean;
}

/** A que categoria um débito se refere. Vazio tira a etiqueta. */
export class ClassificarContaDto {
  @IsOptional() @IsUUID() categoriaId?: string | null;
}

/**
 * A mesma etiqueta em vários títulos de uma vez — é assim que se classifica o
 * que já está em aberto sem abrir conta por conta.
 *
 * O teto existe para o pedido não virar uma escrita sem fim no banco; hoje a
 * empresa tem pouco mais de 500 títulos em aberto, então ele sobra. Quem
 * esbarrar nele recebe o número de volta na mensagem, em vez de ver metade da
 * seleção ser gravada em silêncio.
 */
export class ClassificarLoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  idsFnApagar!: number[];

  @IsOptional() @IsUUID() categoriaId?: string | null;
}
