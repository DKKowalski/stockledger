import { SaleReturnService } from './sale-return.service.js';
import { ValuationService } from './valuation.service.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { SaleCompletionService } from './sale-completion.service.js';
import { PricingPreviewService } from './pricing-preview.service.js';
import { CostReadinessService } from './cost-readiness.service.js';

@Module({ imports: [AuthModule], controllers: [InventoryController], providers: [InventoryService, PricingPreviewService, SaleCompletionService, CostReadinessService, ValuationService, SaleReturnService] })
export class InventoryModule {}
