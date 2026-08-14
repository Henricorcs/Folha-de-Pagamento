import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { AssinaturasController } from './assinaturas.controller';
import { AssinaturasService } from './assinaturas.service';

@Module({
  imports: [FinanceiroModule],
  controllers: [AssinaturasController],
  providers: [AssinaturasService],
  exports: [AssinaturasService],
})
export class AssinaturasModule {}
