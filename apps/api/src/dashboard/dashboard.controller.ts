import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import { DashboardService } from './dashboard.service';

class QueryDashboardDto {
  /** Competência analisada; padrão = mês corrente. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'competencia deve estar no formato AAAA-MM',
  })
  competencia?: string;
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  resumo(@Query() query: QueryDashboardDto) {
    return this.dashboard.resumo(query.competencia);
  }
}
