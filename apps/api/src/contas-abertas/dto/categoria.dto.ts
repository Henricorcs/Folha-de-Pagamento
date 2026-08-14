import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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
