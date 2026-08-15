import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AtualizarRecorrenteDto,
  CriarRecorrenteDto,
} from './dto/recorrente.dto';
import { RecorrentesService } from './recorrentes.service';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/** As despesas que se repetem todo mês, e a rotina que as faz virar conta. */
@Controller('recorrentes')
export class RecorrentesController {
  constructor(private readonly service: RecorrentesService) {}

  @Get()
  listar(@Query('ativas') ativas?: string) {
    return this.service.listar(ativas !== 'true');
  }

  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarRecorrenteDto, @Req() req: Request) {
    return this.service.criar(dto, usuarioId(req));
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarRecorrenteDto) {
    return this.service.atualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.service.remover(id);
    return { ok: true };
  }

  /**
   * Gera agora o que já entrou na janela de antecedência. A rotina faz isso
   * sozinha a cada seis horas; este botão existe para não esperar por ela.
   */
  @Post('gerar-agora')
  @HttpCode(200)
  gerarAgora(@Req() req: Request) {
    return this.service.gerarPendentes(usuarioId(req));
  }
}
