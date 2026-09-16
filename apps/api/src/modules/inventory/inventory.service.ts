import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { CreateMovementDto } from './dto/create-movement.dto.js';
import { buildSnapshot, type ItemRecord, type MovementRecord } from './inventory-calculations.js';
import { MOVEMENT_SIGN, StockMovementType } from './inventory.types.js';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(days = 30) {
    const [items, movements] = await Promise.all([
      this.prisma.client.orm.public.InventoryItem.all(),
      this.prisma.client.orm.public.StockMovement.all(),
    ]);
    return buildSnapshot(items as ItemRecord[], movements as MovementRecord[], days);
  }

  async createItem(body: CreateItemDto) {
    const sku = body.sku.trim().toUpperCase();
    const existing = await this.prisma.client.orm.public.InventoryItem.first({
      sku: sku as Varchar<40>,
    });
    if (existing) throw new ConflictException(`SKU ${sku} already exists`);

    return this.prisma.client.orm.public.InventoryItem.create({
      sku: sku as Varchar<40>,
      name: body.name.trim() as Varchar<120>,
      category: body.category.trim() as Varchar<80>,
      unit: body.unit.trim() as Varchar<20>,
      reorderLevel: body.reorderLevel,
      unitCostCents: body.unitCostCents,
      openingStock: body.openingStock,
    });
  }

  async createMovement(body: CreateMovementDto) {
    const item = await this.prisma.client.orm.public.InventoryItem.first({ id: body.itemId });
    if (!item) throw new NotFoundException('Inventory item not found');

    if (MOVEMENT_SIGN[body.type] === -1) {
      const current = (await this.snapshot()).positions.find(
        (position) => position.item.id === body.itemId,
      );
      if (!current || body.quantity > current.closing) {
        throw new ConflictException(`Only ${current?.closing ?? 0} ${item.unit} available`);
      }
    }

    return this.prisma.client.orm.public.StockMovement.create({
      itemId: body.itemId,
      type: body.type,
      quantity: body.quantity,
      movementDate: body.movementDate,
      reference: body.reference?.trim() ? (body.reference.trim() as Varchar<80>) : null,
      note: body.note?.trim() ? (body.note.trim() as Varchar<500>) : null,
    });
  }

  async deleteMovement(id: string) {
    const movement = await this.prisma.client.orm.public.StockMovement.first({ id });
    if (!movement) throw new NotFoundException('Stock movement not found');

    if (MOVEMENT_SIGN[movement.type as StockMovementType] === 1) {
      const current = (await this.snapshot()).positions.find(
        (position) => position.item.id === movement.itemId,
      );
      if (current && current.closing - movement.quantity < 0) {
        throw new ConflictException('Later outbound movements depend on this stock');
      }
    }

    await this.prisma.client.orm.public.StockMovement.where({ id }).delete();
    return { id };
  }
}
