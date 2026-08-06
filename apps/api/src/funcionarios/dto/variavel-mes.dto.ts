import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

/**
 * O que muda de mês para mês e compõe o saldo salarial: vendas (comissão) e
 * horas extras. A competência aqui é o **mês trabalhado** — o mesmo que a
 * observação do salário cita ("referente ao mês 07/2026").
 */
export class VariavelMesDto {
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'competencia deve estar no formato AAAA-MM',
  })
  competencia!: string;

  /** Quantas vendas a pessoa fez no mês. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? 0 : Number(value)))
  @IsInt()
  @Min(0)
  vendas?: number;

  /** Valor por venda desta competência; vazio = o do cadastro. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : Number(value)))
  @IsNumber()
  @Min(0)
  valorPorVenda?: number | null;

  /** Horas extras do mês (só para quem não tem carteira assinada). */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? 0 : Number(value)))
  @IsNumber()
  @Min(0)
  horasExtras?: number;

  @IsOptional()
  @IsString()
  observacao?: string;
}
