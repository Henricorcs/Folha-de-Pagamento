import { Module } from '@nestjs/common';
import { IxcModule } from '../ixc/ixc.module';
import { FuncionariosModule } from '../funcionarios/funcionarios.module';
import { ValesModule } from '../vales/vales.module';
import { AvulsosController } from './avulsos.controller';
import { AvulsosService } from './avulsos.service';
import { ConfigFinanceiraController } from './config-financeira.controller';
import { ConfigFinanceiraService } from './config-financeira.service';
import { ContasPagarController } from './contas-pagar.controller';
import { ContasPagarService } from './contas-pagar.service';
import { FornecedorService } from './fornecedor.service';
import { PagamentosPollerService } from './pagamentos-poller.service';

@Module({
  // O `FuncionariosModule` entra por causa das faltas: elas descontam do
  // saldo salarial, e quem sabe calculá-las é o serviço de lá.
  imports: [IxcModule, ValesModule, FuncionariosModule],
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
    PagamentosPollerService,
  ],
  exports: [
    ContasPagarService,
    ConfigFinanceiraService,
    AvulsosService,
    FornecedorService,
  ],
})
export class FinanceiroModule {}
