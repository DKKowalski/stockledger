import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { CreateMovementDto } from './dto/create-movement.dto.js';
import { SnapshotQueryDto } from './dto/snapshot-query.dto.js';
import { InventoryService } from './inventory.service.js';

@Controller('inventory')
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('snapshot')
  snapshot(@Query() query: SnapshotQueryDto) {
    return this.inventory.snapshot(query.days);
  }

  @Post('items')
  createItem(@Body() body: CreateItemDto) {
    return this.inventory.createItem(body);
  }

  @Post('movements')
  createMovement(@Body() body: CreateMovementDto) {
    return this.inventory.createMovement(body);
  }

  @Delete('movements/:id')
  deleteMovement(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.deleteMovement(id);
  }
}
