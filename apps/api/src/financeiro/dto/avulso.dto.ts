import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { FormaPagamento } from '@prisma/client';
import { TIPOS_CHAVE_PIX } from '../../ixc/ixc.financeiro';

/** Cadastro de quem recebe fora da folha: mão de obra, serviço, patrocínio. */
export class CriarBeneficiarioDto {
  @IsString() @MinLength(2) nome!: string;

  @IsOptional() @IsString() cpfCnpj?: string;
  @IsOptional() @IsIn(['F', 'J']) tipoPessoa?: string;
  @IsOptional() @IsString() telefone?: string;
  @IsOptional() @IsString() email?: string;

  @IsOptional() @IsString() chavePix?: string;

  /** Tipo da chave PIX; vazio = deduzir pelo formato. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : value))
  @IsIn([...TIPOS_CHAVE_PIX])
  tipoChavePix?: string | null;

  /** Quanto ganha por venda — cliente da empresa também vende e comissiona. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : Number(value)))
  @IsNumber()
  @Min(0)
  valorPorVenda?: number | null;

  @IsOptional() @IsEnum(FormaPagamento) formaPagamento?: FormaPagamento;

  @IsOptional() @IsString() observacoes?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  cidadeIxc?: number;

  /**
   * Fornecedor do IXC a reaproveitar. Vem da tela quando a pessoa foi avisada
   * de que aquele CPF/CNPJ já existe lá e escolheu usar o cadastro que existe.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  idFornecedorIxc?: number;

  /** A pessoa foi avisada e mesmo assim quer um fornecedor novo no IXC. */
  @IsOptional() @IsBoolean() fornecedorNovoNoIxc?: boolean;
}

export class UpdateBeneficiarioDto extends CriarBeneficiarioDto {
  @IsOptional() @IsString() @MinLength(2) declare nome: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

/**
 * Um pagamento avulso: o serviço, a comissão das vendas que a pessoa fechou e
 * o extra do trabalho por fora. Tudo somado sai num pagamento só — ver
 * `pagamento.calc`, compartilhado com a diária.
 */
export class PagarAvulsoDto {
  /** Dia do pagamento (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() data?: string;

  /** O trabalho contratado. Zero quando o acerto é só de comissão. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  valorServico?: number;

  /** Quantas vendas a pessoa fechou no período que este pagamento cobre. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  vendas?: number;

  /** Quanto cada venda paga. Vazio = o do cadastro. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  valorPorVenda?: number;

  /** Trabalho por fora que rendeu um troco a mais no mesmo acerto. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  valorExtra?: number;

  @IsOptional() @IsString() descricaoExtra?: string;

  /** O que foi feito — vira observação no IXC e histórico no caixa. */
  @IsString() @MinLength(3) descricao!: string;

  /** Vazio = a forma habitual do cadastro. */
  @IsOptional() @IsEnum(FormaPagamento) forma?: FormaPagamento;

  /** Vazio = a conta contábil de avulsos da configuração. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaContabil?: number;

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

export class QueryPagamentosAvulsosDto {
  @IsOptional() @IsString() beneficiarioId?: string;
}

export class QueryFornecedorIxcDto {
  @IsString() @MinLength(3) cpfCnpj!: string;
}
