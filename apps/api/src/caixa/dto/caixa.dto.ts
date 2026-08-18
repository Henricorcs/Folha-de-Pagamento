import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const numeroOuIndefinido = ({ value }: { value: unknown }) =>
  value === '' || value == null ? undefined : Number(value);

/**
 * Teto da foto da nota, em caracteres do data URL.
 *
 * Um milhão de caracteres é ~750 KB de imagem — bem acima do que a tela manda
 * (ela reduz a foto antes de enviar) e bem abaixo do que uma foto crua de
 * celular teria. O limite existe para o caso de alguém mandar pela API: uma
 * tabela de fotos cruas enche o disco do servidor, que é o mesmo do banco.
 */
const TETO_DA_FOTO = 1_000_000;

const RECADO_DA_FOTO =
  'A foto ficou grande demais. Tire de novo pela tela, que ela reduz sozinha.';

export class PeriodoDoCaixaDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data inicial precisa estar no formato AAAA-MM-DD.',
  })
  de!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data final precisa estar no formato AAAA-MM-DD.',
  })
  ate!: string;
}

export class ConferirLancamentoDto {
  @IsOptional()
  @IsBoolean()
  conferido?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;
}

export class NotaDto {
  /** Data URL da imagem. `null` tira a foto que estava lá. */
  @IsOptional()
  @IsString()
  @MaxLength(TETO_DA_FOTO, { message: RECADO_DA_FOTO })
  @Matches(/^data:image\/(png|jpe?g|webp);base64,/, {
    message: 'A nota precisa ser uma imagem (PNG, JPEG ou WebP).',
  })
  notaFoto?: string | null;
}

/** Dinheiro que sai do caixa com alguém para pagar algo na rua. */
export class EntregarDinheiroDto {
  @IsInt()
  @Transform(numeroOuIndefinido)
  caixaId!: number;

  @IsString()
  @MinLength(2, { message: 'Diga com quem o dinheiro está.' })
  @MaxLength(120)
  pessoa!: string;

  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0.01, { message: 'O valor precisa ser maior que zero.' })
  valor!: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data da entrega precisa estar no formato AAAA-MM-DD.',
  })
  entregueEm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}

/**
 * A prestação de contas de quem levou dinheiro.
 *
 * Nota e troco vêm juntos porque é a soma dos dois que fecha com o que saiu —
 * receber um sem o outro deixaria a diferença passar sem ninguém olhar.
 */
export class BaixarDinheiroDto {
  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0, { message: 'O valor da nota não pode ser negativo.' })
  valorGasto!: number;

  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0, { message: 'O troco não pode ser negativo.' })
  troco?: number;

  @IsOptional()
  @IsString()
  @MaxLength(TETO_DA_FOTO, { message: RECADO_DA_FOTO })
  @Matches(/^data:image\/(png|jpe?g|webp);base64,/, {
    message: 'A nota precisa ser uma imagem (PNG, JPEG ou WebP).',
  })
  notaFoto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;
}

export class FecharCaixaDto {
  @IsInt()
  @Transform(numeroOuIndefinido)
  caixaId!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data inicial precisa estar no formato AAAA-MM-DD.',
  })
  de!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data final precisa estar no formato AAAA-MM-DD.',
  })
  ate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string;

  /**
   * Quanto havia na gaveta no início do período.
   *
   * Só faz falta no primeiro fechamento de cada caixa: do segundo em diante, o
   * anterior diz de onde a contagem parte.
   */
  @IsOptional()
  @Transform(numeroOuIndefinido)
  @IsNumber()
  saldoInicial?: number;
}
