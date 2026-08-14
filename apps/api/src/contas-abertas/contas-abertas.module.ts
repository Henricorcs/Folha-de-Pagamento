import { Module } from '@nestjs/common';
import { IxcModule } from '../ixc/ixc.module';
import { ContasAbertasController } from './contas-abertas.controller';
import { ContasAbertasService } from './contas-abertas.service';

@Module({
  imports: [IxcModule],
  controllers: [ContasAbertasController],
  providers: [ContasAbertasService],
})
export class ContasAbertasModule {}
