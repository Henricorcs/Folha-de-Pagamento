import { Module } from '@nestjs/common';
import { IxcModule } from '../ixc/ixc.module';
import { CategoriasController } from './categorias.controller';
import { CategoriasService } from './categorias.service';
import { ContasAbertasController } from './contas-abertas.controller';
import { ContasAbertasService } from './contas-abertas.service';

@Module({
  imports: [IxcModule],
  controllers: [ContasAbertasController, CategoriasController],
  providers: [ContasAbertasService, CategoriasService],
})
export class ContasAbertasModule {}
