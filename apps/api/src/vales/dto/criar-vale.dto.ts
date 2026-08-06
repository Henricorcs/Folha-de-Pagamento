import { SentidoVale } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

const numeroOuIndefinido = ({ value }: { value: unknown }) =>
  value === '' || value == null ? undefined : Number(value);

export class CriarValeDto {
  @IsString()
  funcionarioId!: string;

  /**
   * DESCONTO: o funcionário deve à empresa (vale, compra parcelada) e a folha
   * abate. CREDITO: a empresa deve ao funcionário (reembolso de algo que ele
   * comprou, serviço extra) e a folha soma. Padrão: DESCONTO.
   */
  @IsOptional()
  @IsEnum(SentidoVale)
  sentido?: SentidoVale;

  @IsString()
  @MinLength(2)
  descricao!: string;

  /** Total do vale. Sozinho, é dividido pelo número de parcelas. */
  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0.01)
  valorTotal?: number;

  /** Valor de cada parcela. Quando informado, é ele que manda. */
  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0.01)
  valorParcela?: number;

  /** 1 = vale avulso (desconto de uma vez). */
  @IsInt()
  @Min(1)
  @Max(120)
  quantidadeParcelas!: number;

  /** Competência da folha em que a primeira parcela é descontada. */
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'competenciaInicio deve estar no formato AAAA-MM',
  })
  competenciaInicio!: string;

  /** Desligado: o vale fica só registrado, sem descontar da folha. */
  @IsOptional()
  @IsBoolean()
  descontarDaFolha?: boolean;

  /** Data da concessão (padrão: hoje). */
  @IsOptional()
  @IsString()
  data?: string;

  @IsOptional()
  @IsString()
  observacao?: string;
}
