import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  Min,
} from 'class-validator';

export class CriarPagamentoAvulsoDto {
  /** Se informado, paga um beneficiário já existente (ignora os dados abaixo). */
  @IsOptional() @IsString() beneficiarioAvulsoId?: string;

  @IsOptional() @IsString() @MinLength(2) nome?: string;
  @IsOptional() @IsString() cpfCnpj?: string;
  @IsOptional() @IsIn(['F', 'J']) tipoPessoa?: string;
  @IsOptional() @IsString() chavePix?: string;
  @IsOptional() @IsInt() @Min(1) cidadeIxc?: number;

  @IsNumber() @Min(0.01) valor!: number;

  /** Conta contábil (id_conta) do lançamento avulso — obrigatória. */
  @IsInt() @Min(1) contaContabil!: number;

  @IsString() @MinLength(3) observacao!: string;
}
