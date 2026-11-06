import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';

@Module({ imports: [AuthModule, InventoryModule], controllers: [FinanceController], providers: [FinanceService] })
export class FinanceModule {}
