import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import type { UserRole } from '../auth/auth.types.js';
import { buildSnapshot, type ItemRecord, type LocationRecord, type MovementRecord, type StockRecord } from './inventory-calculations.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { CreateMovementDto } from './dto/create-movement.dto.js';
import { ImportItemsDto } from './dto/import-items.dto.js';
import { UpdateSellingPriceDto } from './dto/update-selling-price.dto.js';
import { MOVEMENT_SIGN, StockMovementType } from './inventory.types.js';

type Actor = {
  id: string;
  role: UserRole;
  companyId: string;
  locationId: string | null;
};

type AuditJson = string | number | boolean | null | readonly AuditJson[] | { readonly [key: string]: AuditJson };

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(userId: string, companyId: string, days = 30, locationId?: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      const scope = await this.scope(tx, companyId);
      const selected = this.visibleLocation(actor, scope.locations, locationId);
      return buildSnapshot(
        scope.items,
        actor.role === 'shop_attendant' ? scope.locations.filter((location) => location.id === selected) : scope.locations,
        scope.stocks,
        scope.movements,
        days,
        selected,
      );
    });
  }

  async createLocation(userId: string, companyId: string, body: CreateLocationDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertAdministrator(actor);
      const name = body.name.trim();
      const existing = await tx.orm.public.Location.first({
        companyId,
        name: name as Varchar<120>,
      });
      if (existing) throw new ConflictException(`${name} already exists`);

      return this.presentLocation(await tx.orm.public.Location.create({
        companyId,
        name: name as Varchar<120>,
        type: body.type,
      }));
    });
  }

  async createItem(userId: string, companyId: string, body: CreateItemDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertAdministrator(actor);
      await this.lockCompany(tx, companyId);
      const scope = await this.scope(tx, companyId);
      this.knownLocation(scope.locations, body.locationId);
      const requestedSku = body.sku?.trim().toUpperCase();
      const usedSkus = new Set(scope.items.map((item) => item.sku.toUpperCase()));
      if (requestedSku && usedSkus.has(requestedSku)) throw new ConflictException(`Item code ${requestedSku} already exists`);
      const sku = requestedSku || this.availableSku(body.name, usedSkus);

      const item = await tx.orm.public.InventoryItem.create({
        companyId,
        sku: sku as Varchar<40>,
        name: body.name.trim() as Varchar<120>,
        category: body.category.trim() as Varchar<80>,
        unit: body.unit.trim() as Varchar<20>,
        reorderLevel: body.reorderLevel,
        unitCostCents: body.unitCostCents,
        sellingPriceCents: body.sellingPriceCents ?? null,
      });
      await tx.orm.public.LocationStock.create({
        companyId,
        locationId: body.locationId,
        itemId: item.id,
        openingStock: body.openingStock,
      });
      return item;
    });
  }

  async importItems(userId: string, companyId: string, body: ImportItemsDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertAdministrator(actor);
      await this.lockCompany(tx, companyId);
      const scope = await this.scope(tx, companyId);
      this.knownLocation(scope.locations, body.locationId);

      const normalized = body.rows.map((row) => ({ ...row, sku: row.sku?.trim().toUpperCase() }));
      const duplicateInFile = normalized.find((row, index) => row.sku && normalized.findIndex((candidate) => candidate.sku === row.sku) !== index);
      if (duplicateInFile?.sku) throw new ConflictException(`Item code ${duplicateInFile.sku} appears more than once in the spreadsheet`);
      const existingSkus = new Set(scope.items.map((item) => item.sku.toUpperCase()));
      const existing = normalized.find((row) => row.sku && existingSkus.has(row.sku));
      if (existing?.sku) throw new ConflictException(`Item code ${existing.sku} already exists`);
      const usedSkus = new Set(existingSkus);
      const rows = normalized.map((row) => {
        const sku = row.sku || this.availableSku(row.name, usedSkus);
        usedSkus.add(sku);
        return { ...row, sku };
      });

      for (const row of rows) {
        const item = await tx.orm.public.InventoryItem.create({
          companyId,
          sku: row.sku as Varchar<40>,
          name: row.name.trim() as Varchar<120>,
          category: row.category.trim() as Varchar<80>,
          unit: row.unit.trim() as Varchar<20>,
          reorderLevel: row.reorderLevel,
          unitCostCents: row.unitCostCents,
          sellingPriceCents: row.sellingPriceCents ?? null,
        });
        await tx.orm.public.LocationStock.create({
          companyId,
          locationId: body.locationId,
          itemId: item.id,
          openingStock: row.openingStock,
        });
      }
      await this.audit(tx, actor, 'inventory.items_imported', 'location', body.locationId, {
        imported: rows.length,
        skus: rows.map((row) => row.sku),
      });
      return { imported: rows.length };
    });
  }

  async updateSellingPrice(userId: string, companyId: string, itemId: string, body: UpdateSellingPriceDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertAdministrator(actor);
      await this.lockItem(tx, companyId, itemId);
      const item = await tx.orm.public.InventoryItem.first({ id: itemId, companyId });
      if (!item) throw new NotFoundException('Inventory item not found');
      await tx.orm.public.InventoryItem.where({ id: itemId, companyId })
        .update({ sellingPriceCents: body.sellingPriceCents });
      await this.audit(tx, actor, 'inventory.selling_price_changed', 'inventory_item', itemId, {
        previousSellingPriceCents: item.sellingPriceCents,
        sellingPriceCents: body.sellingPriceCents,
      });
      return tx.orm.public.InventoryItem.first({ id: itemId, companyId });
    });
  }

  async createMovement(userId: string, companyId: string, body: CreateMovementDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      if (body.type === StockMovementType.SALE) {
        if (actor.role !== 'shop_attendant' || !actor.locationId) {
          throw new ForbiddenException('Only a shop attendant can record a sale');
        }
      } else if (actor.role === 'shop_attendant') {
        throw new ForbiddenException('Shop attendants can only record a sale');
      }
      await this.lockItem(tx, companyId, body.itemId);
      return this.recordMovement(tx, actor, body);
    });
  }

  private async recordMovement(tx: PrismaTransaction, actor: Actor, body: CreateMovementDto) {
    const scope = await this.scope(tx, actor.companyId, body.itemId);
    const item = scope.items.find((candidate) => candidate.id === body.itemId);
    if (!item) throw new NotFoundException('Inventory item not found');
    const unitPriceCents = body.type === StockMovementType.SALE ? item.sellingPriceCents : null;
    if (body.type === StockMovementType.SALE) {
      if (unitPriceCents === null) throw new ConflictException('Ask an administrator to set a selling price for this item');
      if (body.expectedUnitPriceCents !== undefined && body.expectedUnitPriceCents !== unitPriceCents) {
        throw new ConflictException('The selling price has changed. Refresh and review the price before recording this sale');
      }
      if (!Number.isSafeInteger(unitPriceCents * body.quantity)) {
        throw new BadRequestException('The sale total is too large');
      }
    }
    const locationId = body.type === StockMovementType.SALE ? actor.locationId! : body.locationId;
    const place = this.knownLocation(scope.locations, locationId);
    if (body.type === StockMovementType.SALE && place.type !== 'shop') {
      throw new BadRequestException('A sale is recorded at a shop');
    }

    const destinationId = body.destinationLocationId ?? null;
    if (body.type === StockMovementType.TRANSFER) {
      if (!destinationId) throw new BadRequestException('Choose the place that receives the stock');
      if (destinationId === locationId) throw new BadRequestException('Choose a different place to receive the stock');
      this.knownLocation(scope.locations, destinationId);
    } else if (destinationId) {
      throw new BadRequestException('Only a transfer moves stock into another place');
    }

    if (MOVEMENT_SIGN[body.type] === -1) {
      const current = buildSnapshot(scope.items, scope.locations, scope.stocks, scope.movements, 30, locationId)
        .positions.find((position) => position.item.id === body.itemId);
      if (!current || body.quantity > current.closing) {
        throw new ConflictException(`Only ${current?.closing ?? 0} ${item.unit} available`);
      }
    }

    return tx.orm.public.StockMovement.create({
      companyId: actor.companyId,
      itemId: body.itemId,
      locationId,
      destinationLocationId: destinationId,
      type: body.type,
      quantity: body.quantity,
      unitPriceCents,
      movementDate: body.movementDate,
      reference: body.reference?.trim() ? (body.reference.trim() as Varchar<80>) : null,
      note: body.note?.trim() ? (body.note.trim() as Varchar<500>) : null,
    });
  }

  async deleteMovement(userId: string, companyId: string, id: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      if (actor.role === 'shop_attendant') {
        throw new ForbiddenException('Shop attendants cannot remove stock movements');
      }
      const target = await tx.orm.public.StockMovement.first({ id, companyId });
      if (!target) throw new NotFoundException('Stock movement not found');
      await this.lockItem(tx, companyId, target.itemId);
      return this.removeMovement(tx, actor, id, target.itemId);
    });
  }

  private async removeMovement(tx: PrismaTransaction, actor: Actor, id: string, itemId: string) {
    const scope = await this.scope(tx, actor.companyId, itemId);
    const movement = scope.movements.find((candidate) => candidate.id === id);
    if (!movement) throw new NotFoundException('Stock movement not found');

    const remaining = scope.movements.filter((candidate) => candidate.id !== id);
    const affected = [movement.locationId, movement.destinationLocationId].filter((locationId): locationId is string => Boolean(locationId));
    for (const locationId of affected) {
      const negative = buildSnapshot(scope.items, scope.locations, scope.stocks, remaining, 30, locationId)
        .positions.some((position) => position.closing < 0);
      if (negative) throw new ConflictException('Later movements depend on this stock');
    }

    await tx.orm.public.StockMovement.where({ id, companyId: actor.companyId }).delete();
    await this.audit(tx, actor, 'inventory.movement_deleted', 'stock_movement', id, {
      itemId: movement.itemId,
      locationId: movement.locationId,
      destinationLocationId: movement.destinationLocationId,
      type: movement.type,
      quantity: movement.quantity,
      unitPriceCents: movement.unitPriceCents,
      movementDate: movement.movementDate,
      reference: movement.reference,
      note: movement.note,
    });
    return { id };
  }

  private async lockItem(tx: PrismaTransaction, companyId: string, itemId: string) {
    const rows = await tx.query(this.prisma.client.raw.sql`
      SELECT id FROM public.inventory_items
      WHERE id = ${itemId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `.returnsRow({ id: 'pg/uuid@1' }).build());
    if (rows.length === 0) throw new NotFoundException('Inventory item not found');
  }

  private async lockCompany(tx: PrismaTransaction, companyId: string) {
    await tx.query(this.prisma.client.raw.sql`
      SELECT id FROM public.companies
      WHERE id = ${companyId}::uuid
      FOR UPDATE
    `.returnsRow({ id: 'pg/uuid@1' }).build());
  }

  private availableSku(name: string, usedSkus: ReadonlySet<string>) {
    const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const stem = normalized.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ITEM';
    let candidate = stem.slice(0, 40);
    let sequence = 2;
    while (usedSkus.has(candidate)) {
      const suffix = `-${sequence}`;
      candidate = `${stem.slice(0, 40 - suffix.length)}${suffix}`;
      sequence += 1;
    }
    return candidate;
  }

  private async actor(tx: PrismaTransaction, companyId: string, userId: string): Promise<Actor> {
    const user = await tx.orm.public.User.first({ id: userId, companyId });
    if (!user || user.isActive === false) throw new UnauthorizedException('Account no longer exists');
    return {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      locationId: user.locationId,
    };
  }

  private async scope(tx: PrismaTransaction, companyId: string, itemId?: string) {
    const itemQuery = tx.orm.public.InventoryItem.where({ companyId });
    const [items, locations] = await Promise.all([
      (itemId ? itemQuery.where({ id: itemId }) : itemQuery).all(),
      tx.orm.public.Location.where({ companyId }).all(),
    ]);
    const [stocks, movements] = await Promise.all([
      itemId
        ? tx.orm.public.LocationStock.where({ companyId, itemId }).all()
        : tx.orm.public.LocationStock.where({ companyId }).all(),
      itemId
        ? tx.orm.public.StockMovement.where({ companyId, itemId }).all()
        : tx.orm.public.StockMovement.where({ companyId }).all(),
    ]);
    return {
      items: items as ItemRecord[],
      locations: locations.map((location) => this.presentLocation(location)),
      stocks: stocks as StockRecord[],
      movements: movements as MovementRecord[],
    };
  }

  private visibleLocation(actor: Actor, locations: readonly LocationRecord[], requested?: string) {
    if (actor.role === 'shop_attendant') {
      if (!actor.locationId) throw new ForbiddenException('This account is not assigned to a shop');
      return actor.locationId;
    }
    if (!requested) return null;
    this.knownLocation(locations, requested);
    return requested;
  }

  private knownLocation(locations: readonly LocationRecord[], locationId: string) {
    const location = locations.find((candidate) => candidate.id === locationId);
    if (!location) throw new NotFoundException('Place not found');
    return location;
  }

  private assertAdministrator(actor: Actor) {
    if (actor.role !== 'administrator') throw new ForbiddenException('Only an administrator can change company setup');
  }

  private presentLocation(location: { id: string; name: string; type: 'warehouse' | 'shop' }): LocationRecord {
    return { id: location.id, name: location.name, type: location.type };
  }

  private async audit(
    tx: PrismaTransaction,
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string,
    metadata: { readonly [key: string]: AuditJson },
  ) {
    await tx.orm.public.AuditEvent.create({
      companyId: actor.companyId,
      actorUserId: actor.id,
      action: action as Varchar<80>,
      entityType: entityType as Varchar<80>,
      entityId,
      metadata,
    });
  }
}
