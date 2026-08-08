import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { CaixaService } from './caixa.service';
import { DadosBancariosService } from './dados-bancarios.service';
import { IxcClient } from './ixc.client';
import { createIxcHttp, IXC_HTTP } from './ixc.http';

@Module({
  providers: [
    {
      provide: IXC_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createIxcHttp(config.getOrThrow<AppConfig['ixc']>('ixc')),
    },
    IxcClient,
    DadosBancariosService,
    CaixaService,
  ],
  exports: [IxcClient, DadosBancariosService, CaixaService],
})
export class IxcModule {}
