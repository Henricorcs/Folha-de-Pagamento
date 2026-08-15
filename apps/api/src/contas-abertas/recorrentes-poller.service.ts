import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { RecorrentesService } from './recorrentes.service';

/** De quanto em quanto tempo se olha se há conta recorrente para nascer. */
const INTERVALO_MS = 6 * 60 * 60 * 1000;

/**
 * Espera de um minuto antes da primeira rodada. Subir a API e já sair criando
 * conta no IXC atrapalha o start; um minuto também dá tempo de derrubar um
 * container que subiu por engano com o banco de produção.
 */
const ESPERA_INICIAL_MS = 60_000;

/**
 * Quem faz a despesa recorrente virar conta a pagar sozinha.
 *
 * Roda a cada seis horas, e não uma vez por dia, porque uma falha do IXC na
 * única tentativa do dia atrasaria a conta em 24 horas — com quatro chances,
 * uma indisponibilidade de manhã se resolve à tarde, ainda dentro dos dias de
 * antecedência.
 *
 * Gerar de novo o que já foi gerado não é risco: o vencimento da recorrente só
 * anda quando a conta nasce de fato no IXC.
 */
@Injectable()
export class RecorrentesPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecorrentesPollerService.name);
  private timer: NodeJS.Timeout | null = null;
  private inicial: NodeJS.Timeout | null = null;
  private executando = false;

  constructor(
    private readonly config: ConfigService,
    private readonly recorrentes: RecorrentesService,
  ) {}

  onModuleInit(): void {
    const ixc = this.config.get<AppConfig['ixc']>('ixc');
    if (!ixc?.host || !ixc?.token) {
      this.logger.warn(
        'Despesas recorrentes inativas: IXC_HOST/IXC_TOKEN não configurados',
      );
      return;
    }

    this.inicial = setTimeout(() => void this.tick(), ESPERA_INICIAL_MS);
    this.inicial.unref?.();
    this.timer = setInterval(() => void this.tick(), INTERVALO_MS);
    this.timer.unref?.();
    this.logger.log('Despesas recorrentes: verificação a cada 6 h');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.inicial) clearTimeout(this.inicial);
  }

  private async tick(): Promise<void> {
    // Sem sobreposição: o IXC lento faria duas rodadas correrem juntas, e a
    // segunda leria vencimentos que a primeira ainda não tinha avançado.
    if (this.executando) return;
    this.executando = true;
    try {
      const r = await this.recorrentes.gerarPendentes();
      if (r.geradas > 0) {
        this.logger.log(
          `Recorrentes: ${r.geradas} conta(s) geradas — ${r.fornecedores.join(', ')}`,
        );
      }
      for (const e of r.erros) {
        this.logger.warn(`Recorrente de ${e.fornecedor}: ${e.erro}`);
      }
    } catch (err) {
      this.logger.error(
        `Rodada de recorrentes falhou: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.executando = false;
    }
  }
}
