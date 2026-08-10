import { Module } from '@nestjs/common';
import { FuncionariosModule } from '../funcionarios/funcionarios.module';
import { ImpostosModule } from '../impostos/impostos.module';
import { ValesModule } from '../vales/vales.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [FuncionariosModule, ValesModule, ImpostosModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
