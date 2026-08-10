import { Controller, Get, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { DashboardService } from './dashboard.service';

class QueryDashboardDto {
  /** Competência analisada; padrão = mês corrente. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'competencia deve estar no formato AAAA-MM',
  })
  competencia?: string;

  /** Quantos meses as séries cobrem, contando a competência. Padrão 12. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(24)
  meses?: number;
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  resumo(@Query() query: QueryDashboardDto) {
    return this.dashboard.resumo(query.competencia, query.meses);
  }
}
