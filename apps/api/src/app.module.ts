import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { configuration } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { IxcModule } from './ixc/ixc.module';
import { SyncModule } from './sync/sync.module';
import { FuncionariosModule } from './funcionarios/funcionarios.module';
import { FinanceiroModule } from './financeiro/financeiro.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
    }),
    PrismaModule,
    AuthModule,
    IxcModule,
    SyncModule,
    FuncionariosModule,
    FinanceiroModule,
  ],
  controllers: [HealthController],
  providers: [
    // Protege todas as rotas por padrão; use @Public() para abrir exceções.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
