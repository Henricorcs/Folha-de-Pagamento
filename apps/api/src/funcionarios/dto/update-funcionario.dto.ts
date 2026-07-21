import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * Campos editáveis localmente. Dados que vêm do IXC (nome, salário, etc.)
 * podem ser ajustados aqui, mas serão sobrescritos na próxima sincronização —
 * por isso o foco são campos internos (observações) e complementos.
 */
export class UpdateFuncionarioDto {
  @IsOptional()
  @IsString()
  observacoes?: string;

  @IsOptional()
  @IsString()
  chavePix?: string;

  @IsOptional()
  @IsString()
  banco?: string;

  @IsOptional()
  @IsString()
  agencia?: string;

  @IsOptional()
  @IsString()
  conta?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  salarioBase?: number;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  // --- Configuração da folha ---
  @IsOptional()
  @IsBoolean()
  carteiraAssinada?: boolean;

  @IsOptional()
  @IsBoolean()
  recebeAdiantamento?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(1)
  cidadeIxc?: number;
}
