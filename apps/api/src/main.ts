import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableCors({
    origin: config.getOrThrow<string>('app.webOrigin'),
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
  });
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>('app.port'), '0.0.0.0');
}

await bootstrap();
