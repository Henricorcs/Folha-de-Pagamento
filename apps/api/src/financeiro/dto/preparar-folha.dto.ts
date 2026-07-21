import { IsArray, IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class PrepararFolhaDto {
  /** Competência no formato "AAAA-MM" */
  @Matches(/^\d{4}-\d{2}$/, { message: 'competencia deve estar no formato AAAA-MM' })
  competencia!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  funcionarioIds?: string[];

  @IsOptional() @IsBoolean() incluirAdiantamento?: boolean;
  @IsOptional() @IsBoolean() incluirSalario?: boolean;
  @IsOptional() @IsBoolean() incluirBonus?: boolean;
}
