import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Uma despesa que se repete todo mês. O que se guarda é a regra; a conta a
 * pagar de cada mês nasce sozinha, poucos dias antes de vencer.
 */
export class CriarRecorrenteDto {
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  idFornecedorIxc!: number;

  @IsString() @MinLength(2) @MaxLength(200) fornecedorNome!: string;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor!: number;

  @IsString() @MinLength(3) @MaxLength(500) observacao!: string;

  /** Vencimento da próxima conta a ser gerada (AAAA-MM-DD). */
  @IsISO8601() proximoVencimento!: string;

  /**
   * Com quantos dias de antecedência a conta nasce. O teto de 45 evita que
   * alguém peça uma antecedência maior que o próprio ciclo mensal, o que faria
   * duas contas nascerem quase juntas.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(45)
  diasDeAntecedencia?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaContabil?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  @IsOptional() @IsString() @MaxLength(40) tipoPagamentoIxc?: string;

  @IsOptional() @IsUUID() categoriaId?: string | null;

  /** Vencimento em sabado, domingo ou feriado anda para o proximo dia util. */
  @IsOptional() @IsBoolean() apenasDiasUteis?: boolean;
}

export class AtualizarRecorrenteDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor?: number;

  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) observacao?: string;

  @IsOptional() @IsISO8601() proximoVencimento?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(45)
  diasDeAntecedencia?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaContabil?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  @IsOptional() @IsString() @MaxLength(40) tipoPagamentoIxc?: string;

  @IsOptional() @IsUUID() categoriaId?: string | null;

  /** Desligada, para de gerar. O que já gerou continua de pé. */
  @IsOptional() @IsBoolean() ativa?: boolean;

  /** Vencimento em sábado, domingo ou feriado anda para o próximo dia útil. */
  @IsOptional() @IsBoolean() apenasDiasUteis?: boolean;
}
