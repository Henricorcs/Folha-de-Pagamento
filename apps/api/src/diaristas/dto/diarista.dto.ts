import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { FormaPagamentoDiaria } from '@prisma/client';
import { TIPOS_CHAVE_PIX } from '../../ixc/ixc.financeiro';

export class CriarDiaristaDto {
  @IsString() @MinLength(2) nome!: string;

  @IsOptional() @IsString() cpfCnpj?: string;
  @IsOptional() @IsString() telefone?: string;
  @IsOptional() @IsString() chavePix?: string;

  /** Tipo da chave PIX; vazio = deduzir pelo formato. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : value))
  @IsIn([...TIPOS_CHAVE_PIX])
  tipoChavePix?: string | null;

  /** Valor combinado por dia; só sugere o valor na hora de pagar. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : Number(value)))
  @IsNumber()
  @Min(0)
  valorDiaria?: number | null;

  @IsOptional() @IsEnum(FormaPagamentoDiaria) formaPagamento?: FormaPagamentoDiaria;

  @IsOptional() @IsString() observacoes?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  cidadeIxc?: number;
}

export class UpdateDiaristaDto extends CriarDiaristaDto {
  @IsOptional() @IsString() @MinLength(2) declare nome: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
