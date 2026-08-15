import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { FornecedorService } from '../financeiro/fornecedor.service';
import { DespesasService } from './despesas.service';
import { CriarDespesaDto, PagarTituloDto } from './dto/despesa.dto';
import { PagamentosService } from './pagamentos.service';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

function usuarioNome(req: Request): string | undefined {
  return (req.user as { nome?: string } | undefined)?.nome;
}

/** Lançar uma conta a pagar à mão, e achar no IXC o fornecedor dela. */
@Controller()
export class DespesasController {
  constructor(
    private readonly service: DespesasService,
    private readonly fornecedores: FornecedorService,
    private readonly pagamentos: PagamentosService,
  ) {}

  /**
   * Paga um título que já está no IXC. Pelo banco, aprova e deixa pronto; em
   * mãos, aprova e dá a baixa na conta do caixa.
   */
  @Post('contas-abertas/:idFnApagar/pagar')
  @HttpCode(200)
  pagar(
    @Param('idFnApagar', ParseIntPipe) idFnApagar: number,
    @Body() dto: PagarTituloDto,
    @Req() req: Request,
  ) {
    return this.pagamentos.pagar(idFnApagar, dto, usuarioNome(req));
  }

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
