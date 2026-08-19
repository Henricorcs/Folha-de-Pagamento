import { Transform } from 'class-transformer';
import {
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

/** A senha da própria pessoa, para abrir a tela de transferências. */
export class DestravarDto {
  @IsString()
  @MinLength(1, { message: 'Digite sua senha.' })
  @MaxLength(200)
  senha!: string;
}

/** Dinheiro que muda de conta: sai de uma e entra na outra. */
export class TransferirDto {
  @Transform(numeroOuIndefinido)
  @IsInt({ message: 'Escolha a conta de origem.' })
  @Min(1)
  origemId!: number;

  @Transform(numeroOuIndefinido)
  @IsInt({ message: 'Escolha a conta de destino.' })
  @Min(1)
  destinoId!: number;

  @Transform(numeroOuIndefinido)
  @IsNumber()
  @Min(0.01, { message: 'O valor precisa ser maior que zero.' })
  valor!: number;

  /** Dia em que o dinheiro mudou de lugar. Vazio = hoje. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data precisa estar no formato AAAA-MM-DD.',
  })
  data?: string;

  /** O que aparece no lançamento das duas contas no IXC. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  historico?: string;

  /** Dinheiro, Pix, Depósito… entra no histórico, junto do resto. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  forma?: string;
}
