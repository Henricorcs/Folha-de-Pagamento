import { Body, Controller, Get, Put } from '@nestjs/common';
import { ConfigFinanceiraService } from './config-financeira.service';
import { UpdateConfigFinanceiraDto } from './dto/update-config.dto';

@Controller('config-financeira')
export class ConfigFinanceiraController {
  constructor(private readonly service: ConfigFinanceiraService) {}

  @Get()
  obter() {
    return this.service.obter();
  }

  @Put()
  atualizar(@Body() dto: UpdateConfigFinanceiraDto) {
    return this.service.atualizar(dto);
  }
}
