import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AvulsosService } from './avulsos.service';
import { CriarPagamentoAvulsoDto } from './dto/avulso.dto';

@Controller('avulsos')
export class AvulsosController {
  constructor(private readonly service: AvulsosService) {}

  @Get('beneficiarios')
  listarBeneficiarios(@Query('busca') busca?: string) {
    return this.service.listarBeneficiarios(busca);
  }

  /** Cria um pagamento avulso (beneficiário + conta a pagar no IXC). */
  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarPagamentoAvulsoDto, @Req() req: Request) {
    const uid = (req.user as { id?: string } | undefined)?.id;
    return this.service.criarPagamento(dto, uid);
  }
}
