import { SentidoVale } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class QueryValesDto {
  @IsOptional()
  @IsString()
  funcionarioId?: string;

  /** DESCONTO = funcionário deve; CREDITO = empresa deve. */
  @IsOptional()
  @IsEnum(SentidoVale)
  sentido?: SentidoVale;

  /** ABERTO = ainda tem parcela a descontar; QUITADO = todas descontadas. */
  @IsOptional()
  @IsIn(['ABERTO', 'QUITADO', 'CANCELADO', 'TODOS'])
  situacao?: 'ABERTO' | 'QUITADO' | 'CANCELADO' | 'TODOS';

  @IsOptional()
  @IsString()
  busca?: string;

  /** Só os vales com parcela nesta competência ("AAAA-MM"). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'competencia deve estar no formato AAAA-MM',
  })
  competencia?: string;
}
