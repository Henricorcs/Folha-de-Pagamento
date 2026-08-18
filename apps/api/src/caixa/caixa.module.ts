import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { IxcModule } from '../ixc/ixc.module';
import { FechamentoCaixaController } from './fechamento-caixa.controller';
import { FechamentoCaixaService } from './fechamento-caixa.service';

/**
 * Bater o caixa do dinheiro em mãos.
 *
 * O IXC entra por causa do `CaixaService`, que sabe achar a tabela de
 * movimento e ler os lançamentos; o financeiro, por causa da configuração
 * (qual tabela, qual caixa é o de dinheiro em mãos).
 */
@Module({
  imports: [IxcModule, FinanceiroModule],
  controllers: [FechamentoCaixaController],
  providers: [FechamentoCaixaService],
})
export class CaixaModule {}
