import { Module } from '@nestjs/common';
import { ImpostosController } from './impostos.controller';
import { ImpostosService } from './impostos.service';

@Module({
  controllers: [ImpostosController],
  providers: [ImpostosService],
  exports: [ImpostosService],
})
export class ImpostosModule {}
