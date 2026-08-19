import { Module } from '@nestjs/common';
import { FaltasService } from './faltas.service';
import { FuncionariosController } from './funcionarios.controller';
import { FuncionariosService } from './funcionarios.service';

@Module({
  controllers: [FuncionariosController],
  providers: [FuncionariosService, FaltasService],
  // O `FaltasService` sai daqui porque a folha precisa dele para descontar as
  // faltas do mês ao gerar as contas a pagar.
  exports: [FuncionariosService, FaltasService],
})
export class FuncionariosModule {}
