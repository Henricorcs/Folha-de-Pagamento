import { Module } from '@nestjs/common';
import { IxcModule } from '../ixc/ixc.module';
import { AvulsosController } from './avulsos.controller';
import { AvulsosService } from './avulsos.service';
import { ConfigFinanceiraController } from './config-financeira.controller';
import { ConfigFinanceiraService } from './config-financeira.service';
import { ContasPagarController } from './contas-pagar.controller';
import { ContasPagarService } from './contas-pagar.service';
import { FornecedorService } from './fornecedor.service';

@Module({
  imports: [IxcModule],
  controllers: [
    ConfigFinanceiraController,
    ContasPagarController,
    AvulsosController,
  ],
  providers: [
    ConfigFinanceiraService,
    FornecedorService,
    ContasPagarService,
    AvulsosService,
  ],
  exports: [ContasPagarService, ConfigFinanceiraService],
})
export class FinanceiroModule {}
