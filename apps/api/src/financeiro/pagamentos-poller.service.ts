import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { ContasPagarService } from './contas-pagar.service';

/**
 * "Esperar o retorno do banco": verifica periodicamente no IXC as contas
 * aguardando pagamento e marca como PAGO quando o banco confirma.
 * Intervalo em minutos via SYNC_PAGAMENTOS_INTERVALO_MIN (0 desliga).
 */
@Injectable()
export class PagamentosPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PagamentosPollerService.name);
  private timer: NodeJS.Timeout | null = null;
  private executando = false;

  constructor(
    private readonly config: ConfigService,
    private readonly contasPagar: ContasPagarService,
  ) {}

  onModuleInit(): void {
    const minutos = this.config.get<number>('pollPagamentosMin') ?? 10;
    const ixc = this.config.get<AppConfig['ixc']>('ixc');

    if (!minutos || minutos <= 0) {
      this.logger.log('Polling de pagamentos desligado (intervalo 0)');
      return;
    }
    if (!ixc?.host || !ixc?.token) {
      this.logger.warn(
        'Polling de pagamentos inativo: IXC_HOST/IXC_TOKEN não configurados',
      );
      return;
    }

    this.timer = setInterval(() => void this.tick(), minutos * 60_000);
    this.timer.unref?.();
    this.logger.log(`Polling de pagamentos a cada ${minutos} min`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.executando) return; // evita sobreposição se o IXC estiver lento
    this.executando = true;
    try {
      const r = await this.contasPagar.sincronizarPendentes();
      if (r.pagas > 0 || r.erros > 0) {
        this.logger.log(
          `Retorno do banco: ${r.verificadas} verificadas, ${r.pagas} pagas, ${r.erros} erros`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Polling de pagamentos falhou: ${message}`);
    } finally {
      this.executando = false;
    }
  }
}
