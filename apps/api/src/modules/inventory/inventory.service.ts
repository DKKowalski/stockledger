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
import { CreateStockCountDto } from './dto/create-stock-count.dto.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { ImportItemsDto } from './dto/import-items.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { UpdateSellingPriceDto } from './dto/update-selling-price.dto.js';
import { MOVEMENT_SIGN, StockMovementType } from './inventory.types.js';
import { buildProfitability } from './profitability-calculations.js';

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

  async updateItem(userId: string, companyId: string, itemId: string, body: UpdateItemDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertAdministrator(actor);
      await this.lockItem(tx, companyId, itemId);
      const item = await tx.orm.public.InventoryItem.first({ id: itemId, companyId });
      if (!item) throw new NotFoundException('Inventory item not found');
      const sku = body.sku?.trim().toUpperCase();
      if (sku && sku !== item.sku) {
        const duplicate = await tx.orm.public.InventoryItem.first({ companyId, sku: sku as Varchar<40> });
        if (duplicate) throw new ConflictException(`Item code ${sku} already exists`);
      }
      if (body.isActive === false && item.isActive) {
        const scope = await this.scope(tx, companyId, itemId);
        const onHand = buildSnapshot(scope.items, scope.locations, scope.stocks, scope.movements).positions
          .reduce((total, position) => total + position.closing, 0);
        if (onHand !== 0) throw new ConflictException('Move or count this item down to zero before archiving it');
      }
      const changes = {
        ...(sku ? { sku: sku as Varchar<40> } : {}),
        ...(body.name !== undefined ? { name: body.name.trim() as Varchar<120> } : {}),
        ...(body.category !== undefined ? { category: body.category.trim() as Varchar<80> } : {}),
        ...(body.unit !== undefined ? { unit: body.unit.trim() as Varchar<20> } : {}),
        ...(body.reorderLevel !== undefined ? { reorderLevel: body.reorderLevel } : {}),
        ...(body.unitCostCents !== undefined ? { unitCostCents: body.unitCostCents } : {}),
        ...(body.sellingPriceCents !== undefined ? { sellingPriceCents: body.sellingPriceCents } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      };
      await tx.orm.public.InventoryItem.where({ id: itemId, companyId }).update(changes);
      await this.audit(tx, actor, 'inventory.item_updated', 'inventory_item', itemId, {
        previousSku: item.sku,
        previousUnitCostCents: item.unitCostCents,
        previousSellingPriceCents: item.sellingPriceCents,
        ...changes,
      });
      return tx.orm.public.InventoryItem.first({ id: itemId, companyId });
    });
  }

  async listSuppliers(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertInventoryManager(actor);
      const suppliers = await tx.orm.public.Supplier.where({ companyId }).all();
      return suppliers.sort((left, right) => left.name.localeCompare(right.name));
    });
  }

  async createSupplier(userId: string, companyId: string, body: CreateSupplierDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertInventoryManager(actor);
      const name = body.name.trim();
      if (await tx.orm.public.Supplier.first({ companyId, name: name as Varchar<120> })) {
        throw new ConflictException(`${name} already exists`);
      }
      const supplier = await tx.orm.public.Supplier.create({
        companyId,
        name: name as Varchar<120>,
        email: body.email?.trim().toLowerCase() ? body.email.trim().toLowerCase() as Varchar<255> : null,
        phone: body.phone?.trim() ? body.phone.trim() as Varchar<40> : null,
        address: body.address?.trim() ? body.address.trim() as Varchar<300> : null,
      });
      await this.audit(tx, actor, 'inventory.supplier_created', 'supplier', supplier.id, { name });
      return supplier;
    });
  }

  async updateSupplier(userId: string, companyId: string, supplierId: string, body: UpdateSupplierDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertInventoryManager(actor);
      const supplier = await tx.orm.public.Supplier.first({ id: supplierId, companyId });
      if (!supplier) throw new NotFoundException('Supplier not found');
      const name = body.name?.trim();
      if (name && name !== supplier.name && await tx.orm.public.Supplier.first({ companyId, name: name as Varchar<120> })) {
        throw new ConflictException(`${name} already exists`);
      }
      const changes = {
        ...(name ? { name: name as Varchar<120> } : {}),
        ...(body.email !== undefined ? { email: body.email.trim().toLowerCase() as Varchar<255> } : {}),
        ...(body.phone !== undefined ? { phone: body.phone.trim() as Varchar<40> } : {}),
        ...(body.address !== undefined ? { address: body.address.trim() as Varchar<300> } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      };
      await tx.orm.public.Supplier.where({ id: supplierId, companyId }).update(changes);
      await this.audit(tx, actor, 'inventory.supplier_updated', 'supplier', supplierId, { name: name ?? supplier.name, isActive: body.isActive ?? supplier.isActive });
      return tx.orm.public.Supplier.first({ id: supplierId, companyId });
    });
  }

  async createStockCount(userId: string, companyId: string, body: CreateStockCountDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertInventoryManager(actor);
      await this.lockItem(tx, companyId, body.itemId);
      const scope = await this.scope(tx, companyId, body.itemId);
      const item = scope.items[0];
      if (!item || !item.isActive) throw new NotFoundException('Inventory item not found');
      this.knownLocation(scope.locations, body.locationId);
      const expectedQuantity = buildSnapshot(scope.items, scope.locations, scope.stocks, scope.movements, 30, body.locationId)
        .positions.find((position) => position.item.id === body.itemId)?.closing ?? 0;
      const varianceQuantity = body.countedQuantity - expectedQuantity;
      const count = await tx.orm.public.StockCount.create({
        companyId,
        itemId: body.itemId,
        locationId: body.locationId,
        countedByUserId: actor.id,
        expectedQuantity,
        countedQuantity: body.countedQuantity,
        varianceQuantity,
        unitCostCents: item.unitCostCents,
        countedAt: body.countedAt,
        note: body.note?.trim() ? body.note.trim() as Varchar<500> : null,
      });
      if (varianceQuantity !== 0) {
        await tx.orm.public.StockMovement.create({
          companyId,
          itemId: body.itemId,
          locationId: body.locationId,
          destinationLocationId: null,
          type: varianceQuantity > 0 ? StockMovementType.ADJUSTMENT_IN : StockMovementType.ADJUSTMENT_OUT,
          quantity: Math.abs(varianceQuantity),
          unitPriceCents: null,
          unitCostCents: item.unitCostCents,
          supplierId: null,
          relatedMovementId: null,
          stockCountId: count.id,
          movementDate: body.countedAt,
          reference: null,
          note: body.note?.trim() ? body.note.trim() as Varchar<500> : null,
        });
      }
      await this.audit(tx, actor, 'inventory.stock_counted', 'stock_count', count.id, {
        itemId: body.itemId,
        locationId: body.locationId,
        expectedQuantity,
        countedQuantity: body.countedQuantity,
        varianceQuantity,
      });
      return count;
    });
  }

  async listStockCounts(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertInventoryManager(actor);
      const [counts, items, locations] = await Promise.all([
        tx.orm.public.StockCount.where({ companyId }).all(),
        tx.orm.public.InventoryItem.where({ companyId }).all(),
        tx.orm.public.Location.where({ companyId }).all(),
      ]);
      return counts.sort((left, right) => right.countedAt.localeCompare(left.countedAt) || right.createdAt.localeCompare(left.createdAt)).map((count) => ({
        ...count,
        item: items.find((item) => item.id === count.itemId) ?? null,
        location: locations.find((location) => location.id === count.locationId) ?? null,
      }));
    });
  }

  async profitability(userId: string, companyId: string, days: number, locationId?: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertAdministrator(actor);
      const scope = await this.scope(tx, companyId);
      const selected = this.visibleLocation(actor, scope.locations, locationId);
      return buildProfitability(scope.items, scope.locations, scope.movements, days, selected);
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
      if (body.type === StockMovementType.ADJUSTMENT_IN || body.type === StockMovementType.ADJUSTMENT_OUT) {
        throw new BadRequestException('Use a stock count to record an inventory adjustment');
      }
      await this.lockItem(tx, companyId, body.itemId);
      return this.recordMovement(tx, actor, body);
    });
  }

  private async recordMovement(tx: PrismaTransaction, actor: Actor, body: CreateMovementDto) {
    const scope = await this.scope(tx, actor.companyId, body.itemId);
    const item = scope.items.find((candidate) => candidate.id === body.itemId);
    if (!item) throw new NotFoundException('Inventory item not found');
    let unitPriceCents = body.type === StockMovementType.SALE ? item.sellingPriceCents : null;
    let unitCostCents = body.type === StockMovementType.PURCHASE ? body.unitCostCents ?? null : item.unitCostCents;
    let relatedMovementId: string | null = null;
    if (body.type === StockMovementType.SALE) {
      if (unitPriceCents === null) throw new ConflictException('Ask an administrator to set a selling price for this item');
      if (body.expectedUnitPriceCents !== undefined && body.expectedUnitPriceCents !== unitPriceCents) {
        throw new ConflictException('The selling price has changed. Refresh and review the price before recording this sale');
      }
      if (!Number.isSafeInteger(unitPriceCents * body.quantity)) {
        throw new BadRequestException('The sale total is too large');
      }
    }
    let locationId = body.type === StockMovementType.SALE ? actor.locationId! : body.locationId;
    if (body.type === StockMovementType.PURCHASE && unitCostCents === null) {
      throw new BadRequestException('Enter the unit cost for this purchase');
    }
    if (body.supplierId && body.type !== StockMovementType.PURCHASE) {
      throw new BadRequestException('A supplier can only be attached to a purchase');
    }
    if (body.supplierId) {
      const supplier = await tx.orm.public.Supplier.first({ id: body.supplierId, companyId: actor.companyId, isActive: true });
      if (!supplier) throw new NotFoundException('Supplier not found');
    }
    if (body.type === StockMovementType.RETURN_IN) {
      if (!body.relatedMovementId) throw new BadRequestException('Choose the original sale for this return');
      const sale = scope.movements.find((movement) => movement.id === body.relatedMovementId && movement.type === StockMovementType.SALE);
      if (!sale) throw new NotFoundException('Original sale not found');
      if (sale.itemId !== body.itemId) throw new BadRequestException('The return item must match the original sale');
      const returned = scope.movements
        .filter((movement) => movement.type === StockMovementType.RETURN_IN && movement.relatedMovementId === sale.id)
        .reduce((total, movement) => total + movement.quantity, 0);
      if (returned + body.quantity > sale.quantity) throw new ConflictException(`Only ${sale.quantity - returned} units remain returnable`);
      locationId = sale.locationId;
      unitPriceCents = sale.unitPriceCents;
      unitCostCents = sale.unitCostCents;
      relatedMovementId = sale.id;
    } else if (body.relatedMovementId) {
      throw new BadRequestException('Only a customer return links to an original sale');
    }
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

    const movement = await tx.orm.public.StockMovement.create({
      companyId: actor.companyId,
      itemId: body.itemId,
      locationId,
      destinationLocationId: destinationId,
      type: body.type,
      quantity: body.quantity,
      unitPriceCents,
      unitCostCents,
      supplierId: body.type === StockMovementType.PURCHASE ? body.supplierId ?? null : null,
      relatedMovementId,
      stockCountId: null,
      movementDate: body.movementDate,
      reference: body.reference?.trim() ? (body.reference.trim() as Varchar<80>) : null,
      note: body.note?.trim() ? (body.note.trim() as Varchar<500>) : null,
    });
    if (body.type === StockMovementType.PURCHASE && unitCostCents !== null) {
      const currentQuantity = buildSnapshot(scope.items, scope.locations, scope.stocks, scope.movements).positions
        .reduce((total, position) => total + position.closing, 0);
      const nextCost = this.weightedAverageCost(currentQuantity, item.unitCostCents, body.quantity, unitCostCents);
      await tx.orm.public.InventoryItem.where({ id: item.id, companyId: actor.companyId }).update({ unitCostCents: nextCost });
    }
    return movement;
  }

  async deleteMovement(userId: string, companyId: string, id: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      if (actor.role === 'shop_attendant') {
        throw new ForbiddenException('Shop attendants cannot remove stock movements');
      }
      const target = await tx.orm.public.StockMovement.first({ id, companyId });
      if (!target) throw new NotFoundException('Stock movement not found');
      if (target.stockCountId) {
        throw new BadRequestException('Stock count adjustments cannot be deleted. Record a new count instead.');
      }
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
      unitCostCents: movement.unitCostCents,
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

  private weightedAverageCost(currentQuantity: number, currentCost: number, receivedQuantity: number, receivedCost: number) {
    const quantity = BigInt(currentQuantity + receivedQuantity);
    if (quantity <= 0n) return receivedCost;
    const value = BigInt(currentQuantity) * BigInt(currentCost) + BigInt(receivedQuantity) * BigInt(receivedCost);
    const rounded = (value + quantity / 2n) / quantity;
    if (rounded > 2147483647n) throw new BadRequestException('The weighted average cost is too large');
    return Number(rounded);
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

  private assertInventoryManager(actor: Actor) {
    if (actor.role === 'shop_attendant') throw new ForbiddenException('Shop attendants cannot manage inventory operations');
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
