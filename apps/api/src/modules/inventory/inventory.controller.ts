import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { CreateMovementDto } from './dto/create-movement.dto.js';
import { SnapshotQueryDto } from './dto/snapshot-query.dto.js';
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

  @Post('movements')
  createMovement(@Req() request: AuthenticatedRequest, @Body() body: CreateMovementDto) {
    return this.inventory.createMovement(request.user.sub, body);
  }

  @Delete('movements/:id')
  deleteMovement(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.deleteMovement(request.user.sub, id);
  }
}
