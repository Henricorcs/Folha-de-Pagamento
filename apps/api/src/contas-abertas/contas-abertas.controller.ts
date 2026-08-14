import { Controller, Get } from '@nestjs/common';
import { ContasAbertasService } from './contas-abertas.service';

/**
 * As contas a pagar em aberto da empresa, direto do IXC.
 *
 * Só leitura, e de propósito: o que se faz com uma conta (aprovar, pagar,
 * cancelar) continua sendo feito onde ela mora. Esta tela é para enxergar o
 * todo — quanto se deve, o que já venceu, o que vence essa semana.
 */
@Controller('contas-abertas')
export class ContasAbertasController {
  constructor(private readonly service: ContasAbertasService) {}

  @Get()
  listar() {
    return this.service.listar();
  }
}
