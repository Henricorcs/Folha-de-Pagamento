import { ModoAssinatura } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * O que a pessoa manda ao assinar. Vem de fora do login — quem tem o link
 * assina —, então tudo que chega aqui é conferido antes de virar recibo.
 */
export class AssinarDto {
  /**
   * O desenho, em PNG data URL. O limite de tamanho não é decoração: a
   * assinatura vai inteira para o banco, e sem teto uma imagem colada à mão
   * entope a tabela. Um rabisco de tela de celular não passa de ~40 KB.
   */
  @IsString()
  @Matches(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, {
    message: 'A assinatura precisa ser uma imagem PNG.',
  })
  @MaxLength(400_000, { message: 'A assinatura ficou grande demais.' })
  assinatura!: string;

  /** Como a pessoa confirma se chamar. Vazio = o nome do cadastro. */
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) nome?: string;

  /**
   * Desenhada com o dedo, ou gerada a partir do nome de quem não escreve.
   * Vazio = desenhada, que é o caminho normal.
   */
  @IsOptional() @IsEnum(ModoAssinatura) modo?: ModoAssinatura;
}
