import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { DestravarDto, TransferirDto } from './dto/transferencia.dto';
import { TransferenciasService } from './transferencias.service';

function usuarioId(req: Request): string | undefined {
  return (req.user as { id?: string } | undefined)?.id;
}

/**
 * Transferência entre contas.
 *
 * O módulo inteiro é de ADMIN — inclusive a leitura, que é o que difere das
 * outras telas. Saber quanto anda entre os caixas já é informação de dono, e
 * quem não pode transferir também não precisa ver.
 *
 * A senha pedida na tela é um segundo passo, não a fechadura: quem fecha a
 * porta é este decorador, no servidor. A senha existe para ninguém mover
 * dinheiro por engano numa sessão deixada aberta na mesa.
 */
@Controller('transferencias')
@Roles(UserRole.ADMIN)
export class TransferenciasController {
  constructor(private readonly service: TransferenciasService) {}

  @Post('destravar')
  @HttpCode(200)
  destravar(@Body() dto: DestravarDto, @Req() req: Request) {
    return this.service.destravar(usuarioId(req), dto.senha);
  }

  /** As contas do IXC entre as quais se transfere: caixas e bancos. */
  @Get('contas')
  contas() {
    return this.service.listarContas();
  }

  @Get()
  listar() {
    return this.service.listar();
  }

  @Post()
  @HttpCode(201)
  transferir(@Body() dto: TransferirDto, @Req() req: Request) {
    return this.service.transferir(dto, usuarioId(req));
  }
}
