import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseFilePipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { GravarPrevisaoDto, MarcarFeriasDto } from './dto/ferias.dto';
import { FeriasService } from './ferias.service';

/** Previsão de férias é uma tabelinha de texto; acima disso é arquivo errado. */
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

@Controller('ferias')
export class FeriasController {
  constructor(private readonly service: FeriasService) {}

  /** Lê o PDF e devolve o que entendeu, sem gravar. */
  @Post('previsoes/ler')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: TAMANHO_MAXIMO } }),
  )
  ler(@UploadedFile(new ParseFilePipe()) arquivo: Express.Multer.File) {
    return this.service.ler(arquivo);
  }

  @Post('previsoes')
  @HttpCode(201)
  gravar(@Body() dto: GravarPrevisaoDto, @Req() req: Request) {
    return this.service.gravar(dto, usuarioId(req));
  }

  @Get('previsoes')
  listarPrevisoes() {
    return this.service.listarPrevisoes();
  }

  @Delete('previsoes/:id')
  @HttpCode(200)
  async removerPrevisao(@Param('id') id: string) {
    await this.service.removerPrevisao(id);
    return { ok: true };
  }

  /** Quem é o próximo, quanto prazo cada um tem e quem já está de férias. */
  @Get('fila')
  fila() {
    return this.service.fila();
  }

  @Post('marcadas')
  @HttpCode(201)
  marcar(@Body() dto: MarcarFeriasDto, @Req() req: Request) {
    return this.service.marcar(dto, usuarioId(req));
  }

  @Delete('marcadas/:id')
  @HttpCode(200)
  async desmarcar(@Param('id') id: string) {
    await this.service.desmarcar(id);
    return { ok: true };
  }
}
