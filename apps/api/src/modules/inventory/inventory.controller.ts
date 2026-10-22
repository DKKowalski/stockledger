import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { CreateMovementDto } from './dto/create-movement.dto.js';
import { CreateStockCountDto } from './dto/create-stock-count.dto.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { ImportItemsDto } from './dto/import-items.dto.js';
import { SnapshotQueryDto } from './dto/snapshot-query.dto.js';
import { ProfitabilityQueryDto } from './dto/profitability-query.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { UpdateSellingPriceDto } from './dto/update-selling-price.dto.js';
import { InventoryService } from './inventory.service.js';
import { PricingPreviewService } from './pricing-preview.service.js';
import { CompleteSaleDto, SaleQuoteDto } from './dto/sale.dto.js';
import { SaleCompletionService } from './sale-completion.service.js';
import { PricingQuoteDto, UpdatePricingDto } from './dto/pricing.dto.js';
import { CostReadinessService } from './cost-readiness.service.js';
import { ConfirmCostDto } from './dto/cost-review.dto.js';
import { MovementLedgerQueryDto } from './dto/movement-ledger-query.dto.js';
import { SaleReturnService } from './sale-return.service.js';
import { PrepareReturnDto } from './dto/return.dto.js';
import { ValuationService } from './valuation.service.js';
import { PrepareValuationDto } from './dto/valuation.dto.js';

@Controller('inventory')
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly pricing: PricingPreviewService,
    private readonly sales: SaleCompletionService,
    private readonly costs: CostReadinessService,
    private readonly valuation: ValuationService,
    private readonly returns: SaleReturnService,
  ) {}

  @Get('sale-returns')
  returnSources(@Req() request: AuthenticatedRequest) {
    return this.returns.sources(request.user.sub, request.user.companyId);
  }

  @Get('sale-returns/sources/:type/:id')
  returnSource(@Req() request: AuthenticatedRequest, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.getSource(request.user.sub, request.user.companyId, type, id);
  }

  @Post('sale-returns/requests')
  prepareReturn(@Req() request: AuthenticatedRequest, @Body() body: PrepareReturnDto) {
    return this.returns.prepare(request.user.sub, request.user.companyId, body);
  }

  @Get('sale-returns/requests/:key')
  returnRequest(@Req() request: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string) {
    return this.returns.byKey(request.user.sub, request.user.companyId, key);
  }

  @Post('sale-returns/requests/:key/apply')
  applyReturn(@Req() request: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string) {
    return this.returns.apply(request.user.sub, request.user.companyId, key);
  }

  @Post('sale-returns/requests/:key/cancel')
  cancelReturn(@Req() request: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string) {
    return this.returns.cancel(request.user.sub, request.user.companyId, key);
  }

  @Get('stock-operations')
  stockOperationStatus(@Req() request: AuthenticatedRequest) {
    return this.valuation.stockStatus(request.user.sub, request.user.companyId);
  }

  @Get('items/:id/stock-operations')
  stockOperationItem(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.valuation.stockItem(request.user.sub, request.user.companyId, id);
  }

  @Get('exact-costing')
  exactCostingStatus(@Req() request: AuthenticatedRequest) {
    return this.valuation.status(request.user.sub, request.user.companyId);
  }

  @Get('items/:id/exact-costing')
  exactCosting(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.valuation.get(request.user.sub, request.user.companyId, id);
  }

  @Post('exact-costing/requests')
  prepareValuation(@Req() request: AuthenticatedRequest, @Body() body: PrepareValuationDto) {
    return this.valuation.prepare(request.user.sub, request.user.companyId, body);
  }

  @Get('exact-costing/requests/:key')
  valuationRequest(@Req() request: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string) {
    return this.valuation.byKey(request.user.sub, request.user.companyId, key);
  }

  @Post('exact-costing/requests/:key/apply')
  applyValuation(@Req() request: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string) {
    return this.valuation.apply(request.user.sub, request.user.companyId, key);
  }

  @Post('exact-costing/requests/:key/cancel')
  cancelValuation(@Req() request: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string) {
    return this.valuation.cancel(request.user.sub, request.user.companyId, key);
  }

  @Get('cost-review')
  costReviewStatus(@Req() request: AuthenticatedRequest) {
    return this.costs.status(request.user.sub, request.user.companyId);
  }

  @Get('items/:id/cost-review')
  costReview(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.costs.get(request.user.sub, request.user.companyId, id);
  }

  @Post('items/:id/cost-review')
  confirmCost(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: ConfirmCostDto) {
    return this.costs.confirm(request.user.sub, request.user.companyId, id, body);
  }

  @Get('sale-completion')
  saleCompletionStatus(@Req() request: AuthenticatedRequest) {
    return this.sales.status(request.user.sub, request.user.companyId);
  }

  @Post('sales/quote')
  saleQuote(@Req() request: AuthenticatedRequest, @Body() body: SaleQuoteDto) {
    return this.sales.quote(request.user.sub, request.user.companyId, body);
  }

  @Post('sales/complete')
  completeSale(@Req() request: AuthenticatedRequest, @Body() body: CompleteSaleDto) {
    return this.sales.complete(request.user.sub, request.user.companyId, body);
  }

  @Get('sales/requests/:key')
  saleRequest(@Req() request: AuthenticatedRequest, @Param('key', ParseUUIDPipe) key: string) {
    return this.sales.byKey(request.user.sub, request.user.companyId, key);
  }

  @Get('sales/:id')
  sale(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(request.user.sub, request.user.companyId, id);
  }

  @Get('pricing-preview')
  pricingPreviewStatus(@Req() request: AuthenticatedRequest) {
    return this.pricing.status(request.user.sub, request.user.companyId);
  }

  @Get('items/:id/pricing-preview')
  pricingPreview(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.pricing.get(request.user.sub, request.user.companyId, id);
  }

  @Patch('items/:id/pricing-preview')
  savePricingPreview(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePricingDto) {
    return this.pricing.update(request.user.sub, request.user.companyId, id, body);
  }

  @Post('pricing-preview/quote')
  quote(@Req() request: AuthenticatedRequest, @Body() body: PricingQuoteDto) {
    return this.pricing.quote(request.user.sub, request.user.companyId, body);
  }

  @Get('snapshot')
  snapshot(@Req() request: AuthenticatedRequest, @Query() query: SnapshotQueryDto) {
    return this.inventory.snapshot(request.user.sub, request.user.companyId, query.days, query.locationId);
  }

  @Post('locations')
  createLocation(@Req() request: AuthenticatedRequest, @Body() body: CreateLocationDto) {
    return this.inventory.createLocation(request.user.sub, request.user.companyId, body);
  }

  @Post('items')
  createItem(@Req() request: AuthenticatedRequest, @Body() body: CreateItemDto) {
    return this.inventory.createItem(request.user.sub, request.user.companyId, body);
  }

  @Post('items/import')
  importItems(@Req() request: AuthenticatedRequest, @Body() body: ImportItemsDto) {
    return this.inventory.importItems(request.user.sub, request.user.companyId, body);
  }

  @Patch('items/:id')
  updateItem(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateItemDto) {
    return this.inventory.updateItem(request.user.sub, request.user.companyId, id, body);
  }

  @Get('suppliers')
  suppliers(@Req() request: AuthenticatedRequest) {
    return this.inventory.listSuppliers(request.user.sub, request.user.companyId);
  }

  @Post('suppliers')
  createSupplier(@Req() request: AuthenticatedRequest, @Body() body: CreateSupplierDto) {
    return this.inventory.createSupplier(request.user.sub, request.user.companyId, body);
  }

  @Patch('suppliers/:id')
  updateSupplier(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSupplierDto) {
    return this.inventory.updateSupplier(request.user.sub, request.user.companyId, id, body);
  }

  @Get('stock-counts')
  stockCounts(@Req() request: AuthenticatedRequest) {
    return this.inventory.listStockCounts(request.user.sub, request.user.companyId);
  }

  @Post('stock-counts')
  createStockCount(@Req() request: AuthenticatedRequest, @Body() body: CreateStockCountDto) {
    return this.inventory.createStockCount(request.user.sub, request.user.companyId, body);
  }

  @Get('profitability')
  profitability(@Req() request: AuthenticatedRequest, @Query() query: ProfitabilityQueryDto) {
    return this.inventory.profitability(request.user.sub, request.user.companyId, query);
  }

  @Get('movements')
  movementLedger(@Req() request: AuthenticatedRequest, @Query() query: MovementLedgerQueryDto) {
    return this.inventory.movementLedger(request.user.sub, request.user.companyId, query);
  }

  @Get('movements/returnable-sales')
  returnableSales(@Req() request: AuthenticatedRequest) {
    return this.inventory.returnableSales(request.user.sub, request.user.companyId);
  }

  @Post('movements')
  createMovement(@Req() request: AuthenticatedRequest, @Body() body: CreateMovementDto) {
    return this.inventory.createMovement(request.user.sub, request.user.companyId, body);
  }

  @Patch('items/:id/selling-price')
  updateSellingPrice(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSellingPriceDto) {
    return this.inventory.updateSellingPrice(request.user.sub, request.user.companyId, id, body);
  }

  @Delete('movements/:id')
  deleteMovement(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.deleteMovement(request.user.sub, request.user.companyId, id);
  }
}
