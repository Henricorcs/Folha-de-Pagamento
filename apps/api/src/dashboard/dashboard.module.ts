import { Module } from '@nestjs/common';
import { FuncionariosModule } from '../funcionarios/funcionarios.module';
import { ValesModule } from '../vales/vales.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [FuncionariosModule, ValesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
