import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { FormaPagamentoDiaria } from '@prisma/client';
import { TIPOS_CHAVE_PIX } from '../../ixc/ixc.financeiro';

/** Um pagamento de diária: quantos dias, por quanto e por onde sai. */
export class PagarDiariaDto {
  /** Dia trabalhado (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() data?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.5)
  quantidade?: number;

  /** Valor do dia. Vazio = o do cadastro do diarista. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valorDiaria?: number;

  /** Total, quando foi combinado um valor fechado. Vazio = quantidade × diária. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor?: number;

  /** O serviço feito — vira observação no IXC e histórico no caixa. */
  @IsString() @MinLength(3) descricao!: string;

  /** Vazio = a forma habitual do cadastro do diarista. */
  @IsOptional() @IsEnum(FormaPagamentoDiaria) forma?: FormaPagamentoDiaria;

  /**
   * Chave PIX a usar neste pagamento. Vazio = a do cadastro. O que vier aqui
   * fica gravado no cadastro, para não ter de digitar de novo.
   */
  @IsOptional() @IsString() chavePix?: string;

  /** Tipo da chave; também fica gravado no cadastro. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : value))
  @IsIn([...TIPOS_CHAVE_PIX])
  tipoChavePix?: string;
}

export class QueryDiariasDto {
  @IsOptional() @IsString() diaristaId?: string;
}
