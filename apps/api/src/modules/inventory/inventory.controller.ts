import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { CreateMovementDto } from './dto/create-movement.dto.js';
import { ImportItemsDto } from './dto/import-items.dto.js';
import { SnapshotQueryDto } from './dto/snapshot-query.dto.js';
import { UpdateSellingPriceDto } from './dto/update-selling-price.dto.js';
import { InventoryService } from './inventory.service.js';

@Controller('inventory')
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('snapshot')
  snapshot(@Req() request: AuthenticatedRequest, @Query() query: SnapshotQueryDto) {
    return this.inventory.snapshot(request.user.sub, query.days, query.locationId);
  }

  @Post('locations')
  createLocation(@Req() request: AuthenticatedRequest, @Body() body: CreateLocationDto) {
    return this.inventory.createLocation(request.user.sub, body);
  }

  @Post('items')
  createItem(@Req() request: AuthenticatedRequest, @Body() body: CreateItemDto) {
    return this.inventory.createItem(request.user.sub, body);
  }

  @Post('items/import')
  importItems(@Req() request: AuthenticatedRequest, @Body() body: ImportItemsDto) {
    return this.inventory.importItems(request.user.sub, body);
  }

  @Post('movements')
  createMovement(@Req() request: AuthenticatedRequest, @Body() body: CreateMovementDto) {
    return this.inventory.createMovement(request.user.sub, body);
  }

  @Patch('items/:id/selling-price')
  updateSellingPrice(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSellingPriceDto) {
    return this.inventory.updateSellingPrice(request.user.sub, id, body);
  }

  @Delete('movements/:id')
  deleteMovement(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.deleteMovement(request.user.sub, id);
  }
}
