import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { DiaristasController } from './diaristas.controller';
import { DiaristasService } from './diaristas.service';

@Module({
  imports: [IxcModule, FinanceiroModule],
  controllers: [DiaristasController],
  providers: [DiaristasService],
})
export class DiaristasModule {}
