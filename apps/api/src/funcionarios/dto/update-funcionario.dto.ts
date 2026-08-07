import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { TIPOS_CHAVE_PIX } from '../../ixc/ixc.financeiro';

/**
 * Campos editáveis localmente. Dados que vêm do IXC (nome, salário, etc.)
 * podem ser ajustados aqui, mas serão sobrescritos na próxima sincronização —
 * por isso o foco são campos internos (observações) e complementos.
 */
export class UpdateFuncionarioDto {
  @IsOptional()
  @IsString()
  observacoes?: string;

  @IsOptional()
  @IsString()
  chavePix?: string;

  /**
   * Tipo da chave marcado na conta a pagar do IXC. Normalmente vem do cadastro
   * do fornecedor no sync; vazio volta a deduzir pelo formato da chave.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : value))
  @IsIn([...TIPOS_CHAVE_PIX])
  tipoChavePix?: string | null;

  @IsOptional()
  @IsString()
  banco?: string;

  @IsOptional()
  @IsString()
  agencia?: string;

  @IsOptional()
  @IsString()
  conta?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  salarioBase?: number;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  // --- Configuração da folha ---
  /** Contratado como CLT (informativo; quem manda na folha é a carteira). */
  @IsOptional()
  @IsBoolean()
  clt?: boolean;

  @IsOptional()
  @IsBoolean()
  carteiraAssinada?: boolean;

  @IsOptional()
  @IsBoolean()
  recebeAdiantamento?: boolean;

  /** Valor do dia 25; 0 ou vazio volta ao percentual da configuração. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : Number(value)))
  @IsNumber()
  @Min(0)
  valorAdiantamento?: number | null;

  /**
   * Só para carteira assinada: o que a folha daqui paga. Preenchido, vira a
   * base do cálculo no lugar do salário base; 0 ou vazio limpa.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : Number(value)))
  @IsNumber()
  @Min(0)
  valorAReceberFolha?: number | null;

  /** Quanto a pessoa ganha por venda (R$ 5 ou R$ 50); vazio = sem comissão. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : Number(value)))
  @IsNumber()
  @Min(0)
  valorPorVenda?: number | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(1)
  cidadeIxc?: number;
}
