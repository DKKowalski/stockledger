import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import config from '../config/index.js';
import envValidation from '../config/env.validation.js';
import { HealthController } from './health.controller.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { DemoProtectionInterceptor } from './demo-protection.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [config], validationSchema: envValidation }),
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DemoProtectionInterceptor,
    },
  ],
})
export class CoreModule {}
