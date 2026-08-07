import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

const email = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase().trim() : value;

export class CriarUsuarioDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @Transform(email)
  @IsEmail({}, { message: 'E-mail inválido' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres' })
  senha!: string;

  /** Padrão RH: usa o app inteiro, menos o gerenciamento de logins. */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class AtualizarUsuarioDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  nome?: string;

  @IsOptional()
  @Transform(email)
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  /** Preenchido, define uma nova senha (o admin não vê a antiga). */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres' })
  senha?: string;
}

export class TrocarSenhaDto {
  @IsString()
  senhaAtual!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres' })
  novaSenha!: string;
}
