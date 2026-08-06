import { Module } from '@nestjs/common';
import { ValesController } from './vales.controller';
import { ValesService } from './vales.service';

@Module({
  controllers: [ValesController],
  providers: [ValesService],
  exports: [ValesService],
})
export class ValesModule {}
