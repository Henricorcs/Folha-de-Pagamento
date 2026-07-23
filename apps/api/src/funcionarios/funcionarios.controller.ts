import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { LancamentoDto } from './dto/lancamento.dto';
import { QueryFuncionariosDto } from './dto/query-funcionarios.dto';
import { UpdateFuncionarioDto } from './dto/update-funcionario.dto';
import { FuncionariosService } from './funcionarios.service';

@Controller('funcionarios')
export class FuncionariosController {
  constructor(private readonly funcionarios: FuncionariosService) {}

  @Get()
  listar(@Query() query: QueryFuncionariosDto) {
    return this.funcionarios.listar(query);
  }

  @Get('resumo')
  resumo() {
    return this.funcionarios.resumo();
  }

  @Get(':id')
  buscar(@Param('id') id: string) {
    return this.funcionarios.buscarPorId(id);
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: UpdateFuncionarioDto) {
    return this.funcionarios.atualizar(id, dto);
  }

  // --- Lançamentos fixos ---
  @Get(':id/lancamentos')
  listarLancamentos(@Param('id') id: string) {
    return this.funcionarios.listarLancamentos(id);
  }

  @Post(':id/lancamentos')
  @HttpCode(201)
  criarLancamento(@Param('id') id: string, @Body() dto: LancamentoDto) {
    return this.funcionarios.criarLancamento(id, dto);
  }

  @Put('lancamentos/:lancamentoId')
  atualizarLancamento(
    @Param('lancamentoId') lancamentoId: string,
    @Body() dto: LancamentoDto,
  ) {
    return this.funcionarios.atualizarLancamento(lancamentoId, dto);
  }

  @Delete('lancamentos/:lancamentoId')
  @HttpCode(200)
  async removerLancamento(@Param('lancamentoId') lancamentoId: string) {
    await this.funcionarios.removerLancamento(lancamentoId);
    return { ok: true };
  }
}
