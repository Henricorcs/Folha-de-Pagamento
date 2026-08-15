import { Transform } from 'class-transformer';
import { TIPOS_CHAVE_PIX } from '../../ixc/ixc.financeiro';
import {
  IsIn,
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
 * Pagar um título que já existe no IXC.
 *
 * `BANCO` aprova na auditoria e deixa a conta pronta para o banco pagar;
 * `EM_MAOS` aprova e dá a baixa na conta do caixa, deixando-a quitada no ato.
 */
export class PagarTituloDto {
  @IsIn(['BANCO', 'EM_MAOS'])
  forma!: 'BANCO' | 'EM_MAOS';

  /** Dia do pagamento (AAAA-MM-DD). Vazio = hoje. Só vale para em mãos. */
  @IsOptional() @IsISO8601() data?: string;

  /** O que aparece no histórico do lançamento no IXC. */
  @IsOptional() @IsString() @MaxLength(200) historico?: string;
}

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

  /**
   * Linha digitável do boleto. Vai como só dígitos para o IXC — é com ela que
   * ele paga; sem ela, a conta chega lá sem como ser paga por boleto.
   */
  @IsOptional() @IsString() @MaxLength(60) codigoBarras?: string;

  /** Número do documento da despesa, quando existe. */
  @IsOptional() @IsString() @MaxLength(40) documento?: string;

  /** Número da nota fiscal, quando a despesa tem uma. */
  @IsOptional() @IsString() @MaxLength(40) numeroNota?: string;

  /**
   * Chave PIX desta conta. Costuma ser o "copia e cola" lido de um QR Code de
   * cobrança, que vale só para este pagamento. Vazio = a chave do cadastro do
   * fornecedor no IXC. O limite cabe um EMV inteiro.
   */
  @IsOptional() @IsString() @MaxLength(600) chavePix?: string;

  /** Tipo da chave acima, como o IXC o nomeia. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : value))
  @IsIn([...TIPOS_CHAVE_PIX])
  tipoChavePix?: string;
}
