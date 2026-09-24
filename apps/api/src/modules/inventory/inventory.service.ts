import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService } from '../../prisma/prisma.service.js';
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

type InventoryClient = Pick<PrismaService['client'], 'orm'>;
type InventoryTransaction = Parameters<Parameters<PrismaService['client']['transaction']>[0]>[0];

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(userId: string, days = 30, locationId?: string) {
    const actor = await this.actor(userId);
    const scope = await this.scope(actor.companyId);
    const selected = this.visibleLocation(actor, scope.locations, locationId);
    return buildSnapshot(
      scope.items,
      actor.role === 'shop_attendant' ? scope.locations.filter((location) => location.id === selected) : scope.locations,
      scope.stocks,
      scope.movements,
      days,
      selected,
    );
  }

  async createLocation(userId: string, body: CreateLocationDto) {
    const actor = await this.actor(userId);
    this.assertAdministrator(actor);
    const name = body.name.trim();
    const existing = await this.prisma.client.orm.public.Location.first({
      companyId: actor.companyId,
      name: name as Varchar<120>,
    });
    if (existing) throw new ConflictException(`${name} already exists`);

    return this.presentLocation(await this.prisma.client.orm.public.Location.create({
      companyId: actor.companyId,
      name: name as Varchar<120>,
      type: body.type,
    }));
  }

  async createItem(userId: string, body: CreateItemDto) {
    const actor = await this.actor(userId);
    this.assertAdministrator(actor);
    const scope = await this.scope(actor.companyId);
    this.knownLocation(scope.locations, body.locationId);
    const sku = body.sku.trim().toUpperCase();
    const existing = scope.items.find((item) => item.sku.toLowerCase() === sku.toLowerCase());
    if (existing) throw new ConflictException(`SKU ${sku} already exists`);

    return this.prisma.client.transaction(async (tx) => {
      const item = await tx.orm.public.InventoryItem.create({
        companyId: actor.companyId,
        sku: sku as Varchar<40>,
        name: body.name.trim() as Varchar<120>,
        category: body.category.trim() as Varchar<80>,
        unit: body.unit.trim() as Varchar<20>,
        reorderLevel: body.reorderLevel,
        unitCostCents: body.unitCostCents,
        sellingPriceCents: body.sellingPriceCents ?? null,
      });
      await tx.orm.public.LocationStock.create({
        locationId: body.locationId,
        itemId: item.id,
        openingStock: body.openingStock,
      });
      return item;
    });
  }

  async importItems(userId: string, body: ImportItemsDto) {
    const actor = await this.actor(userId);
    this.assertAdministrator(actor);
    const scope = await this.scope(actor.companyId);
    this.knownLocation(scope.locations, body.locationId);

    const rows = body.rows.map((row) => ({ ...row, sku: row.sku.trim().toUpperCase() }));
    const duplicateInFile = rows.find((row, index) => rows.findIndex((candidate) => candidate.sku === row.sku) !== index);
    if (duplicateInFile) throw new ConflictException(`SKU ${duplicateInFile.sku} appears more than once in the spreadsheet`);
    const existingSkus = new Set(scope.items.map((item) => item.sku.toUpperCase()));
    const existing = rows.find((row) => existingSkus.has(row.sku));
    if (existing) throw new ConflictException(`SKU ${existing.sku} already exists`);

    return this.prisma.client.transaction(async (tx) => {
      for (const row of rows) {
        const item = await tx.orm.public.InventoryItem.create({
          companyId: actor.companyId,
          sku: row.sku as Varchar<40>,
          name: row.name.trim() as Varchar<120>,
          category: row.category.trim() as Varchar<80>,
          unit: row.unit.trim() as Varchar<20>,
          reorderLevel: row.reorderLevel,
          unitCostCents: row.unitCostCents,
          sellingPriceCents: row.sellingPriceCents ?? null,
        });
        await tx.orm.public.LocationStock.create({
          locationId: body.locationId,
          itemId: item.id,
          openingStock: row.openingStock,
        });
      }
      return { imported: rows.length };
    });
  }

  async updateSellingPrice(userId: string, itemId: string, body: UpdateSellingPriceDto) {
    const actor = await this.actor(userId);
    this.assertAdministrator(actor);
    return this.prisma.client.transaction(async (tx) => {
      await this.lockItem(tx, actor.companyId, itemId);
      await tx.orm.public.InventoryItem.where({ id: itemId, companyId: actor.companyId })
        .update({ sellingPriceCents: body.sellingPriceCents });
      return tx.orm.public.InventoryItem.first({ id: itemId, companyId: actor.companyId });
    });
  }

  async createMovement(userId: string, body: CreateMovementDto) {
    const actor = await this.actor(userId);
    if (body.type === StockMovementType.SALE) {
      if (actor.role !== 'shop_attendant' || !actor.locationId) {
        throw new ForbiddenException('Only a shop attendant can record a sale');
      }
    } else if (actor.role === 'shop_attendant') {
      throw new ForbiddenException('Shop attendants can only record a sale');
    }
    return this.prisma.client.transaction(async (tx) => {
      await this.lockItem(tx, actor.companyId, body.itemId);
      return this.recordMovement(tx, actor, body);
    });
  }

  private async recordMovement(tx: InventoryTransaction, actor: Actor, body: CreateMovementDto) {
    const scope = await this.scope(actor.companyId, tx, body.itemId);
    const item = scope.items.find((candidate) => candidate.id === body.itemId);
    if (!item) throw new NotFoundException('Inventory item not found');
    const unitPriceCents = body.type === StockMovementType.SALE ? item.sellingPriceCents : null;
    if (body.type === StockMovementType.SALE) {
      if (unitPriceCents === null) throw new ConflictException('Ask an administrator to set a selling price for this item');
      if (body.expectedUnitPriceCents !== undefined && body.expectedUnitPriceCents !== unitPriceCents) {
        throw new ConflictException('The selling price has changed. Refresh and review the price before recording this sale');
      }
      if (!Number.isSafeInteger(unitPriceCents! * body.quantity)) {
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

  async deleteMovement(userId: string, id: string) {
    const actor = await this.actor(userId);
    if (actor.role === 'shop_attendant') {
      throw new ForbiddenException('Shop attendants cannot remove stock movements');
    }
    // The first read only identifies the item to lock. Re-read the ledger after
    // acquiring that lock, since another request may have removed this movement.
    const target = await this.prisma.client.orm.public.StockMovement.first({ id });
    if (!target) throw new NotFoundException('Stock movement not found');
    return this.prisma.client.transaction(async (tx) => {
      await this.lockItem(tx, actor.companyId, target.itemId);
      return this.removeMovement(tx, actor, id, target.itemId);
    });
  }

  private async removeMovement(tx: InventoryTransaction, actor: Actor, id: string, itemId: string) {
    const scope = await this.scope(actor.companyId, tx, itemId);
    const movement = scope.movements.find((candidate) => candidate.id === id);
    if (!movement) throw new NotFoundException('Stock movement not found');

    const remaining = scope.movements.filter((candidate) => candidate.id !== id);
    const affected = [movement.locationId, movement.destinationLocationId].filter((locationId): locationId is string => Boolean(locationId));
    for (const locationId of affected) {
      const negative = buildSnapshot(scope.items, scope.locations, scope.stocks, remaining, 30, locationId)
        .positions.some((position) => position.closing < 0);
      if (negative) throw new ConflictException('Later movements depend on this stock');
    }

    await tx.orm.public.StockMovement.where({ id }).delete();
    return { id };
  }

  private async lockItem(tx: InventoryTransaction, companyId: string, itemId: string) {
    // Every stock mutation locks the same item, including transfers and deletes.
    // One row covers both ends of a transfer and locations without an opening
    // balance. Different items can still be changed concurrently.
    const raw = this.prisma.client.raw;
    await tx.execute(raw.sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`.affectedCount().build());
    const rows = await tx.query(raw.sql`
      SELECT id FROM public.inventory_items
      WHERE id = ${itemId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `.returnsRow({ id: 'pg/uuid@1' }).build());
    if (rows.length === 0) throw new NotFoundException('Inventory item not found');
  }

  private async actor(userId: string): Promise<Actor> {
    const user = await this.prisma.client.orm.public.User.first({ id: userId });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      locationId: user.locationId,
    };
  }

  private async scope(companyId: string, client: InventoryClient = this.prisma.client, itemId?: string) {
    const itemQuery = client.orm.public.InventoryItem.where({ companyId });
    const [items, locations] = await Promise.all([
      (itemId ? itemQuery.where({ id: itemId }) : itemQuery).all(),
      client.orm.public.Location.where({ companyId }).all(),
    ]);
    const itemIds = new Set(items.map((item) => item.id));
    const locationIds = new Set(locations.map((location) => location.id));
    const [stocks, movements] = await Promise.all([
      itemIds.size ? client.orm.public.LocationStock.where((stock) => stock.itemId.in([...itemIds])).all() : [],
      itemIds.size ? client.orm.public.StockMovement.where((movement) => movement.itemId.in([...itemIds])).all() : [],
    ]);
    return {
      items: items as ItemRecord[],
      locations: locations.map((location) => this.presentLocation(location)),
      stocks: (stocks as StockRecord[]).filter((stock) => itemIds.has(stock.itemId) && locationIds.has(stock.locationId)),
      movements: (movements as MovementRecord[]).filter((movement) => itemIds.has(movement.itemId)),
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
}
