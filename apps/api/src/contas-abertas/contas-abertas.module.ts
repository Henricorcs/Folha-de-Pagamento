import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { CategoriasController } from './categorias.controller';
import { CategoriasService } from './categorias.service';
import { ContasAbertasController } from './contas-abertas.controller';
import { ContasAbertasService } from './contas-abertas.service';
import { DespesasController } from './despesas.controller';
import { DespesasService } from './despesas.service';
import { PagamentosService } from './pagamentos.service';
import { RecorrentesPollerService } from './recorrentes-poller.service';
import { RecorrentesController } from './recorrentes.controller';
import { RecorrentesService } from './recorrentes.service';

@Module({
  // O financeiro entra por causa da despesa lançada à mão: ela vira conta a
  // pagar pelo mesmo motor da folha (ContasPagarService) e precisa achar o
  // fornecedor no IXC (FornecedorService).
  imports: [IxcModule, FinanceiroModule],
  controllers: [
    ContasAbertasController,
    CategoriasController,
    DespesasController,
    RecorrentesController,
  ],
  providers: [
    ContasAbertasService,
    CategoriasService,
    DespesasService,
    PagamentosService,
    RecorrentesService,
    RecorrentesPollerService,
  ],
})
export class ContasAbertasModule {}
