import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Uma conta a pagar lançada à mão: energia, aluguel, compra de material.
 *
 * O fornecedor é escolhido entre os que já existem no IXC — é ele que o
 * `fn_apagar` exige, e criar cadastro novo daqui só para lançar uma conta
 * encheria a base do IXC de duplicados.
 */
export class CriarDespesaDto {
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  idFornecedorIxc!: number;

  /** Como o fornecedor se chama, para a conta guardar o nome do dia em que foi lançada. */
  @IsString() @MinLength(2) @MaxLength(200) fornecedorNome!: string;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor!: number;

  /** Dia em que a conta foi emitida (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() dataEmissao?: string;

  /** Dia em que ela vence (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() dataVencimento?: string;

  /** O que é essa conta — vai para o campo `obs` do IXC. */
  @IsString() @MinLength(3) @MaxLength(500) observacao!: string;

  /**
   * A etiqueta desta casa. Só pode ser gravada depois que o IXC devolve o
   * número do título, então ela é aplicada no fim, com a conta já criada.
   */
  @IsOptional() @IsUUID() categoriaId?: string | null;

  /** Pix, Dinheiro, Boleto… Vazio = o padrão das Configurações. */
  @IsOptional() @IsString() @MaxLength(40) tipoPagamento?: string;

  /** Conta contábil (id_conta). Vazio = a de avulsos da configuração. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaContabil?: number;
}
