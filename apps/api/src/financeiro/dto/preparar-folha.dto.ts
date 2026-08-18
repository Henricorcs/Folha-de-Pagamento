import { IsArray, IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class PrepararFolhaDto {
  /** Competência no formato "AAAA-MM" */
  @Matches(/^\d{4}-\d{2}$/, { message: 'competencia deve estar no formato AAAA-MM' })
  competencia!: string;

  /**
   * Mês que foi trabalhado, "AAAA-MM". Omitido = o anterior à competência, que
   * é como a folha do quinto dia funciona (agosto sai em setembro). No dia 25 a
   * competência **é** o mês trabalhado, e sem este campo os dois pagamentos do
   * mesmo mês não se reconheceriam — é por ele que a folha do dia 25 sabe de
   * quem já recebeu férias.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'mesTrabalhado deve estar no formato AAAA-MM' })
  mesTrabalhado?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  funcionarioIds?: string[];

  @IsOptional() @IsBoolean() incluirAdiantamento?: boolean;
  @IsOptional() @IsBoolean() incluirSalario?: boolean;
  @IsOptional() @IsBoolean() incluirBonus?: boolean;
}
