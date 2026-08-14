import { Module } from '@nestjs/common';
import { FeriasController } from './ferias.controller';
import { FeriasService } from './ferias.service';

@Module({
  controllers: [FeriasController],
  providers: [FeriasService],
  exports: [FeriasService],
})
export class FeriasModule {}
