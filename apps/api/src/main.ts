import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
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
