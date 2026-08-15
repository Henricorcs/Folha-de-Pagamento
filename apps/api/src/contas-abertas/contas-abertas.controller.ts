import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ContasAbertasService } from './contas-abertas.service';

/**
 * As contas a pagar da empresa, direto do IXC: o que está em aberto e o que já
 * foi pago no mês.
 *
 * A leitura é a mesma tabela que a folha alimenta — salário, diária e avulso
 * viram `fn_apagar` como qualquer despesa —, então o que sai daqui é todo o
 * dinheiro que sai da empresa, e não só o que foi lançado à mão.
 */
@Controller('contas-abertas')
export class ContasAbertasController {
  constructor(private readonly service: ContasAbertasService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  /**
   * O plano de contas do IXC — o código e o nome de cada conta contábil, para
   * as telas de pagamento poderem mostrar "Serviços de terceiros" em vez de
   * "324", e deixar escolher outra.
   */
  @Get('plano-de-contas')
  planoDeContas() {
    return this.service.planoDeContas();
  }

  /** As contas de onde o dinheiro sai — banco e caixa —, como o IXC as tem. */
  @Get('contas-pagamento')
  contasDePagamento() {
    return this.service.contasDePagamento();
  }

  /** Quanto já saiu no mês pelo contas a pagar do IXC. */
  @Get('pagas-no-mes')
  pagasNoMes(@Query('mes') mes?: string) {
    return this.service.pagasNoMes(
      /^\d{4}-\d{2}$/.test(mes ?? '') ? mes : undefined,
    );
  }

  /**
   * Os campos crus do título no IXC. É o que responde "por que esta conta
   * aparece aqui?" sem depender de adivinhar o nome de coluna.
   */
  @Get(':idFnApagar/bruto')
  bruto(@Param('idFnApagar', ParseIntPipe) idFnApagar: number) {
    return this.service.registroBruto(idFnApagar);
  }
}
