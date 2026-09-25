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
import { UpdateItemDto } from './dto/update-item.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { UpdateSellingPriceDto } from './dto/update-selling-price.dto.js';
import { InventoryService } from './inventory.service.js';

@Controller('inventory')
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

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
  profitability(@Req() request: AuthenticatedRequest, @Query() query: SnapshotQueryDto) {
    return this.inventory.profitability(request.user.sub, request.user.companyId, query.days, query.locationId);
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
