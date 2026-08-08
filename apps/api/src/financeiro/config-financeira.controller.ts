import { Body, Controller, Get, Put } from '@nestjs/common';
import { CaixaService } from '../ixc/caixa.service';
import { ConfigFinanceiraService } from './config-financeira.service';
import { UpdateConfigFinanceiraDto } from './dto/update-config.dto';

@Controller('config-financeira')
export class ConfigFinanceiraController {
  constructor(
    private readonly service: ConfigFinanceiraService,
    private readonly caixa: CaixaService,
  ) {}

  @Get()
  obter() {
    return this.service.obter();
  }

  /**
   * Os caixas/contas cadastrados no IXC, para achar o código do "CX - Werick"
   * sem caçar na tela do IXC. É só consulta.
   */
  @Get('caixas')
  async caixas() {
    const cfg = await this.service.obter();
    const { tabela, caixas } = await this.caixa.listarCaixas(
      cfg.caixaTabelaContas,
    );
    return {
      tabela,
      caixas,
      /** O que está valendo hoje para o pagamento em mãos. */
      emUso: await this.caixa.resolverCaixa(cfg),
      nomeProcurado: cfg.caixaEmMaosNome,
    };
  }

  @Put()
  async atualizar(@Body() dto: UpdateConfigFinanceiraDto) {
    const cfg = await this.service.atualizar(dto);
    // Nome de tabela mudou: esquece o que já tinha sido descoberto.
    if (
      dto.caixaTabelaContas !== undefined ||
      dto.caixaTabelaMovimento !== undefined
    ) {
      this.caixa.reset();
    }
    return cfg;
  }
}
