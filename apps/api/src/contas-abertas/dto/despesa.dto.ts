import { Transform, Type } from 'class-transformer';
import { TIPOS_CHAVE_PIX } from '../../ixc/ixc.financeiro';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';

/**
 * Pagar um título que já existe no IXC.
 *
 * `BANCO` aprova na auditoria e deixa a conta pronta para o banco pagar;
 * `EM_MAOS` aprova e dá a baixa na conta do caixa, deixando-a quitada no ato.
 */
export class PagarTituloDto {
  /**
   * Conta de onde o dinheiro sai. É ela que decide o que acontece: a do
   * ModoBank só é aprovada (o pagamento sai pela tela dele no IXC); qualquer
   * outra é aprovada e baixada aqui.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  /** Dia do pagamento (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() data?: string;

  /** O que aparece no histórico do lançamento no IXC. */
  @IsOptional() @IsString() @MaxLength(200) historico?: string;

  /** @deprecated A conta escolhida manda; fica por compatibilidade. */
  @IsOptional() @IsIn(['BANCO', 'EM_MAOS']) forma?: 'BANCO' | 'EM_MAOS';
}

/** Pagar várias contas de uma vez, todas pela mesma conta. */
export class PagarLoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  idsFnApagar!: number[];

  /** De onde sai o dinheiro de todas elas. Ver `PagarTituloDto`. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  /** Dia do pagamento (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() data?: string;

  /** @deprecated A conta escolhida manda; fica por compatibilidade. */
  @IsOptional() @IsIn(['BANCO', 'EM_MAOS']) forma?: 'BANCO' | 'EM_MAOS';
}

/** Apagar vários títulos de uma vez. */
export class ExcluirLoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  idsFnApagar!: number[];
}

/** O que dá para mudar num título que ainda está em aberto no IXC. */
export class EditarTituloDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor?: number;

  @IsOptional() @IsISO8601() dataVencimento?: string;

  @IsOptional() @IsString() @MaxLength(500) observacao?: string;

  @IsOptional() @IsString() @MaxLength(40) tipoPagamento?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaContabil?: number;

  @IsOptional() @IsString() @MaxLength(600) chavePix?: string;

  @IsOptional() @IsString() @MaxLength(60) codigoBarras?: string;

  @IsOptional() @IsString() @MaxLength(40) documento?: string;
}

/**
 * Uma parcela de uma nota lançada em vezes. Cada uma vira uma conta a pagar
 * própria no IXC — é assim que o financeiro de lá entende parcelamento, e é o
 * que deixa pagar a primeira sem mexer nas outras.
 */
export class ParcelaDaDespesaDto {
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor!: number;

  /** Vencimento desta parcela (AAAA-MM-DD). */
  @IsISO8601() dataVencimento!: string;

  /** Código do boleto desta parcela, quando cada uma tem o seu. */
  @IsOptional() @IsString() @MaxLength(60) codigoBarras?: string;

  /** Documento desta parcela, quando cada uma tem o seu. */
  @IsOptional() @IsString() @MaxLength(40) documento?: string;

  /**
   * Como esta parcela se chama na observação do IXC — "13/120".
   *
   * Sem isto o número sai da posição na lista, o que só serve para nota nova.
   * Num consórcio já em andamento a primeira a lançar é a 13 de 120, e chamá-la
   * de "1/85" faria a conta do sistema não bater com o boleto do grupo.
   */
  @IsOptional() @IsString() @MaxLength(20) rotulo?: string;
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

  /** Conta de onde o dinheiro sai (`id_contas`). Vazio = a da configuração. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  /**
   * As parcelas da nota. Vindo preenchido, `valor` e `dataVencimento` acima
   * valem só como a soma e a primeira data que a tela mostrou: quem manda são
   * estas linhas, e cada uma vira uma conta a pagar no IXC.
   *
   * O teto de 240 é o mesmo da tela: vinte anos de parcelas mensais. Era 60,
   * pensando em nota parcelada, mas consórcio de máquina agrícola passa de 100
   * parcelas com facilidade — um trator em 120 meses é comum. Acima de 240 é
   * engano de digitação.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(240)
  @ValidateNested({ each: true })
  @Type(() => ParcelaDaDespesaDto)
  parcelas?: ParcelaDaDespesaDto[];
}
