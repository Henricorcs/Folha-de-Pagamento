import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { TransferenciasController } from './transferencias.controller';
import { TransferenciasService } from './transferencias.service';

/**
 * Transferir dinheiro de uma conta para outra, no IXC junto.
 *
 * O IXC entra por causa do `CaixaService` (que sabe listar as contas e o razão
 * de cada uma) e do `IxcClient`, que escreve as duas linhas da movimentação; o
 * financeiro, por causa da configuração que diz em que tabela as contas moram.
 */
@Module({
  imports: [IxcModule, FinanceiroModule],
  controllers: [TransferenciasController],
  providers: [TransferenciasService],
})
export class TransferenciasModule {}
