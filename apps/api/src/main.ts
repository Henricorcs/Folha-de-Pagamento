import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

/**
 * Teto do corpo em JSON. O padrão do express é 100 KB, e a assinatura do
 * recibo da diária é uma imagem em base64 que passa disso — sem este ajuste
 * ela morre com 413 no caminho, depois de a pessoa já ter assinado.
 */
const LIMITE_CORPO = '1mb';

async function bootstrap() {
  // O parser vem desligado para entrar de novo logo abaixo com o teto maior:
  // se o padrão for registrado antes, é ele quem recusa o corpo grande.
  const app = await NestFactory.create(AppModule, {
    cors: false,
    bodyParser: false,
  });
  app.use(json({ limit: LIMITE_CORPO }));
  app.use(urlencoded({ extended: true, limit: LIMITE_CORPO }));

  const config = app.get(ConfigService);

  const port = config.getOrThrow<AppConfig['port']>('port');
  const corsOrigins = config.getOrThrow<AppConfig['corsOrigins']>('corsOrigins');

  app.setGlobalPrefix('api');
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  await app.listen(port, '0.0.0.0');
  Logger.log(`API ouvindo em http://0.0.0.0:${port}/api`, 'Bootstrap');
}

bootstrap();
