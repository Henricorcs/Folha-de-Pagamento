import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { ImpostosController } from './impostos.controller';
import { ImpostosService } from './impostos.service';

@Module({
  // A guia vira conta a pagar pelo mesmo caminho da despesa lançada à mão
  // (`ContasPagarService`), e precisa achar no IXC quem recebe o imposto
  // (`FornecedorService`).
  imports: [FinanceiroModule],
  controllers: [ImpostosController],
  providers: [ImpostosService],
  exports: [ImpostosService],
})
export class ImpostosModule {}
