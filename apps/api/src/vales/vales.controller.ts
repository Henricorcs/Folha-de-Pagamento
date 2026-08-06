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
} from '@nestjs/common';
import { CriarValeDto } from './dto/criar-vale.dto';
import { QueryValesDto } from './dto/query-vales.dto';
import { UpdateValeDto } from './dto/update-vale.dto';
import { ValesService } from './vales.service';

@Controller('vales')
export class ValesController {
  constructor(private readonly vales: ValesService) {}

  @Get()
  listar(@Query() query: QueryValesDto) {
    return this.vales.listar(query);
  }

  @Get(':id')
  buscar(@Param('id') id: string) {
    return this.vales.buscar(id);
  }

  @Post()
  @HttpCode(201)
  criar(@Body() dto: CriarValeDto) {
    return this.vales.criar(dto);
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: UpdateValeDto) {
    return this.vales.atualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  async remover(@Param('id') id: string) {
    await this.vales.remover(id);
    return { ok: true };
  }

  /** Marca (ou desmarca) uma parcela como descontada fora da folha. */
  @Patch('parcelas/:parcelaId')
  marcarParcela(
    @Param('parcelaId') parcelaId: string,
    @Body() body: { descontada?: boolean },
  ) {
    return this.vales.marcarParcela(parcelaId, body.descontada ?? true);
  }
}
