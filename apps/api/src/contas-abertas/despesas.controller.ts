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
import { FornecedorService } from '../financeiro/fornecedor.service';
import { DespesasService } from './despesas.service';
import { CriarDespesaDto } from './dto/despesa.dto';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/** Lançar uma conta a pagar à mão, e achar no IXC o fornecedor dela. */
@Controller()
export class DespesasController {
  constructor(
    private readonly service: DespesasService,
    private readonly fornecedores: FornecedorService,
  ) {}

  /**
   * Fornecedores do IXC que casam com o que foi digitado — razão social, nome
   * fantasia ou CPF/CNPJ.
   */
  @Get('fornecedores-ixc')
  buscarFornecedores(@Query('busca') busca?: string) {
    return this.fornecedores.buscarNoIxcPorNome(busca ?? '');
  }

  /** Cria a conta a pagar no IXC e a etiqueta com a categoria escolhida. */
  @Post('contas-abertas/despesa')
  @HttpCode(201)
  lancar(@Body() dto: CriarDespesaDto, @Req() req: Request) {
    return this.service.lancar(dto, usuarioId(req));
  }
}
