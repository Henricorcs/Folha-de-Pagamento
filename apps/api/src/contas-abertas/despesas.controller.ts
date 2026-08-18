import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { FornecedorService } from '../financeiro/fornecedor.service';
import { DespesasService } from './despesas.service';
import {
  CriarDespesaDto,
  EditarTituloDto,
  ExcluirLoteDto,
  PagarLoteDto,
  PagarTituloDto,
} from './dto/despesa.dto';
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

  /** Paga várias de uma vez, todas pela mesma forma. */
  @Post('contas-abertas/pagar-lote')
  @HttpCode(200)
  pagarLote(@Body() dto: PagarLoteDto, @Req() req: Request) {
    return this.pagamentos.pagarEmLote(
      dto.idsFnApagar,
      { contaPagamento: dto.contaPagamento, data: dto.data, jaSaiu: dto.jaSaiu },
      usuarioNome(req),
    );
  }

  /** Muda o que dá para mudar num título ainda em aberto. */
  @Patch('contas-abertas/:idFnApagar')
  @HttpCode(200)
  editar(
    @Param('idFnApagar', ParseIntPipe) idFnApagar: number,
    @Body() dto: EditarTituloDto,
  ) {
    return this.pagamentos.editar(idFnApagar, dto);
  }

  /** Apaga vários títulos de uma vez — só os que não foram pagos. */
  @Post('contas-abertas/excluir-lote')
  @HttpCode(200)
  excluirLote(@Body() dto: ExcluirLoteDto) {
    return this.pagamentos.excluirEmLote(dto.idsFnApagar);
  }

  /** Apaga o título no IXC — só o que ainda não foi pago. */
  @Delete('contas-abertas/:idFnApagar')
  @HttpCode(200)
  excluir(@Param('idFnApagar', ParseIntPipe) idFnApagar: number) {
    return this.pagamentos.excluir(idFnApagar);
  }

  /**
   * Fornecedores do IXC que casam com o que foi digitado — razão social, nome
   * fantasia ou CPF/CNPJ.
   */
  @Get('fornecedores-ixc')
  buscarFornecedores(@Query('busca') busca?: string) {
    return this.fornecedores.buscarNoIxcPorNome(busca ?? '');
  }

  /**
   * Um fornecedor do IXC pelo código, com a aba "Dados bancários" junto.
   *
   * A busca por nome não traz a chave PIX de propósito: ela mora noutra tabela e
   * custa uma consulta por fornecedor, o que numa lista seria uma rajada no IXC.
   * Escolhido um, aí sim vale a consulta — é a chave que de fato paga, e quem
   * lança a conta não deveria ter de ir ao IXC copiá-la à mão.
   */
  @Get('fornecedores-ixc/:id')
  buscarFornecedorPorId(@Param('id', ParseIntPipe) id: number) {
    return this.fornecedores.buscarNoIxcPorId(id);
  }

  /** Cria a conta a pagar no IXC e a etiqueta com a categoria escolhida. */
  /**
   * As despesas que ficaram sem chegar ao IXC. Antes de qualquer rota com
   * parâmetro, para não ser lida como id.
   */
  @Get('contas-abertas/despesas-nao-enviadas')
  naoEnviadas() {
    return this.service.naoEnviadas();
  }

  @Post('contas-abertas/despesa')
  @HttpCode(201)
  lancar(@Body() dto: CriarDespesaDto, @Req() req: Request) {
    // O nome vai junto porque um lançamento já pago dá baixa no IXC, e a baixa
    // é assinada: quem conferir o extrato de lá precisa saber quem a fez.
    return this.service.lancar(dto, usuarioId(req), usuarioNome(req));
  }
}
