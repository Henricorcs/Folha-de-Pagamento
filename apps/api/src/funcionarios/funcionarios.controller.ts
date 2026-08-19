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
  Req,
} from '@nestjs/common';
import { LancamentoDto } from './dto/lancamento.dto';
import { QueryFuncionariosDto } from './dto/query-funcionarios.dto';
import { UpdateFuncionarioDto } from './dto/update-funcionario.dto';
import { VariavelMesDto } from './dto/variavel-mes.dto';
import type { Request } from 'express';
import { FaltasService } from './faltas.service';
import { FuncionariosService } from './funcionarios.service';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

@Controller('funcionarios')
export class FuncionariosController {
  constructor(
    private readonly funcionarios: FuncionariosService,
    private readonly faltas: FaltasService,
  ) {}

  /**
   * O calendário de faltas de um mês, com o que elas custam.
   *
   * Antes das rotas com `:id` sozinho não faz falta — o caminho tem segmento
   * próprio —, mas fica junto do resto do funcionário porque é dele que a tela
   * está falando.
   */
  @Get(':id/faltas')
  faltasDoMes(@Param('id') id: string, @Query('competencia') competencia: string) {
    return this.faltas.doMes(id, competencia);
  }

  /** Marca ou desmarca um dia. O mesmo clique nas duas direções. */
  @Put(':id/faltas/:dia')
  @HttpCode(200)
  alternarFalta(
    @Param('id') id: string,
    @Param('dia') dia: string,
    @Req() req: Request,
  ) {
    return this.faltas.alternar(id, dia, usuarioId(req));
  }

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

  // --- Variáveis do mês (vendas e horas extras) ---
  @Get(':id/variaveis')
  listarVariaveis(@Param('id') id: string) {
    return this.funcionarios.listarVariaveis(id);
  }

  @Put(':id/variaveis')
  salvarVariaveis(@Param('id') id: string, @Body() dto: VariavelMesDto) {
    return this.funcionarios.salvarVariaveis(id, dto);
  }

  @Delete(':id/variaveis/:competencia')
  @HttpCode(200)
  async removerVariaveis(
    @Param('id') id: string,
    @Param('competencia') competencia: string,
  ) {
    await this.funcionarios.removerVariaveis(id, competencia);
    return { ok: true };
  }
}
