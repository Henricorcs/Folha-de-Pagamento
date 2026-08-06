import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  // FinanceiroModule exporta a ConfigFinanceiraService (parâmetros do filtro
  // de fornecedor → funcionário).
  imports: [IxcModule, FinanceiroModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
