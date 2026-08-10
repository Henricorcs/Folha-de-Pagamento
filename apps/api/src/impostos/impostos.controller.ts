import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseFilePipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { GravarGuiaDto } from './dto/guia.dto';
import { ImpostosService } from './impostos.service';

/** PDF de guia é pequeno; acima disso é arquivo errado. */
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

@Controller('impostos')
export class ImpostosController {
  constructor(private readonly service: ImpostosService) {}

  /**
   * Lê o PDF e devolve o que entendeu, sem gravar. A tela mostra para conferir
   * — só o POST seguinte grava.
   */
  @Post('guias/ler')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: TAMANHO_MAXIMO } }),
  )
  ler(@UploadedFile(new ParseFilePipe()) arquivo: Express.Multer.File) {
    return this.service.ler(arquivo);
  }

  @Post('guias')
  @HttpCode(201)
  gravar(@Body() dto: GravarGuiaDto, @Req() req: Request) {
    return this.service.gravar(dto, usuarioId(req));
  }

  @Get('guias')
  listar(@Query('competencia') competencia?: string) {
    return this.service.listar(competencia);
  }

  @Delete('guias/:id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.service.remover(id);
    return { ok: true };
  }
}
