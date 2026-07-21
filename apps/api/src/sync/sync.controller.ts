import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** Dispara a sincronização completa (funcionários + adiantamentos). */
  @Post()
  @HttpCode(200)
  async sincronizar() {
    const resultados = await this.sync.syncTudo();
    return { ok: true, resultados };
  }

  @Post('funcionarios')
  @HttpCode(200)
  async sincronizarFuncionarios() {
    return { ok: true, resultado: await this.sync.syncFuncionarios() };
  }

  @Post('adiantamentos')
  @HttpCode(200)
  async sincronizarAdiantamentos() {
    return { ok: true, resultado: await this.sync.syncAdiantamentos() };
  }

  @Get('historico')
  async historico(@Query('limite') limite?: string) {
    return this.sync.historico(limite ? Number(limite) : 20);
  }
}
