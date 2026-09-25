import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';
import { DataExportController } from './data-export.controller.js';
import { DataExportService } from './data-export.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SettingsController, DataExportController],
  providers: [SettingsService, DataExportService],
})
export class SettingsModule {}
