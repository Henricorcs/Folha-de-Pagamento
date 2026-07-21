import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    // Conexão não-fatal: se o banco estiver indisponível no boot, a API ainda
    // sobe e o /health reporta o problema (o Prisma reconecta sob demanda).
    try {
      await this.$connect();
      this.logger.log('Conectado ao PostgreSQL');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao conectar no PostgreSQL no boot: ${message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
