import { assertLegacyItem, valuationPools } from './valuation-ledger.js';
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
import { buildSnapshot, lowestBalanceFrom, withoutCosts, type ItemRecord, type LocationRecord, type MovementRecord, type StockRecord } from './inventory-calculations.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { CreateMovementDto } from './dto/create-movement.dto.js';
import { CreateStockCountDto } from './dto/create-stock-count.dto.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { ImportItemsDto } from './dto/import-items.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { UpdateSellingPriceDto } from './dto/update-selling-price.dto.js';
import { ProfitabilityQueryDto } from './dto/profitability-query.dto.js';
import { MovementLedgerQueryDto } from './dto/movement-ledger-query.dto.js';
import { MOVEMENT_SIGN, StockMovementType } from './inventory.types.js';
import { buildProfitability } from './profitability-calculations.js';

type Actor = {
  id: string;
  role: UserRole;
  companyId: string;
  locationId: string | null;
};

const RECENT_MOVEMENTS = 50;
const RETURNABLE_SALES = 200;

type AuditJson = string | number | boolean | null | readonly AuditJson[] | { readonly [key: string]: AuditJson };

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(userId: string, companyId: string, days = 30, locationId?: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      const scope = await this.scope(tx, companyId);
      const selected = this.visibleLocation(actor, scope.locations, locationId);
      const pools = await valuationPools(tx,companyId);
      const snapshot = buildSnapshot(
        scope.items.map(item => pools.has(item.id) ? {...item,preciseCosting:true} : item),
        scope.locations,
        scope.stocks,
        scope.movements,
        days,
        selected,
        new Date(),
        pools,
      );
      // The full history is paged through movementLedger; the snapshot carries only recent activity.
      const recent = { ...snapshot, movements: snapshot.movements.slice(0, RECENT_MOVEMENTS) };
      if (actor.role !== 'shop_attendant') return recent;
      return { ...withoutCosts(recent), locations: snapshot.locations.filter((location) => location.id === selected) };
    }, { consistentSnapshot:true });
  }

  async movementLedger(userId: string, companyId: string, query: MovementLedgerQueryDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertInventoryManager(actor);
      const scope = await this.scope(tx, companyId);
      const locationId = this.visibleLocation(actor, scope.locations, query.locationId);
      const matching = buildSnapshot(scope.items, scope.locations, scope.stocks, scope.movements, 30, locationId).movements
        .filter((movement) => (!query.type || movement.type === query.type) && (!query.itemId || movement.itemId === query.itemId));
      return {
        movements: matching.slice(query.offset, query.offset + query.limit),
        total: matching.length,
        offset: query.offset,
        limit: query.limit,
      };
    }, { consistentSnapshot:true });
  }

  async returnableSales(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertInventoryManager(actor);
      const scope = await this.scope(tx, companyId);
      const returned = new Map<string, number>();
      for (const movement of scope.movements) {
        if (movement.type === StockMovementType.RETURN_IN && movement.relatedMovementId) {
          returned.set(movement.relatedMovementId, (returned.get(movement.relatedMovementId) ?? 0) + movement.quantity);
        }
      }
      // Grouped sales (saleId) return through the original-allocation workflow instead.
      return buildSnapshot(scope.items, scope.locations, scope.stocks, scope.movements).movements
        .filter((movement) => movement.type === StockMovementType.SALE && !movement.saleId)
        .map((sale) => ({ ...sale, returnableQuantity: sale.quantity - (returned.get(sale.id) ?? 0) }))
        .filter((sale) => sale.returnableQuantity > 0)
        .slice(0, RETURNABLE_SALES);
    }, { consistentSnapshot:true });
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

      const location = await tx.orm.public.Location.create({
        companyId,
        name: name as Varchar<120>,
        type: body.type,
      });
      await this.audit(tx, actor, 'inventory.location_created', 'location', location.id, { name, type: body.type });
      return this.presentLocation(location);
    });
  }

  async createItem(userId: string, companyId: string, body: CreateItemDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertAdministrator(actor);
      await this.lockCompany(tx, companyId);
      const scope = await this.scope(tx, companyId);
      const company = await tx.orm.public.Company.first({ id: companyId });
      if (!company) throw new UnauthorizedException('Business no longer exists');
      const locationId = body.locationId ?? company.defaultLocationId;
      if (!locationId) throw new BadRequestException('Choose an opening location or set a default in Inventory settings');
      this.knownLocation(scope.locations, locationId);
      const requestedSku = body.sku?.trim().toUpperCase();
      const usedSkus = new Set(scope.items.map((item) => item.sku.toUpperCase()));
      if (requestedSku && usedSkus.has(requestedSku)) throw new ConflictException(`Item code ${requestedSku} already exists`);
      const generated = requestedSku ? null : this.availableSequentialSku(company.skuPrefix, company.nextSkuNumber, usedSkus);
      const sku = requestedSku ?? generated!.sku;

      const item = await tx.orm.public.InventoryItem.create({
        companyId,
        sku: sku as Varchar<40>,
        name: body.name.trim() as Varchar<120>,
        category: body.category.trim() as Varchar<80>,
        unit: (body.unit?.trim() || company.defaultUnit) as Varchar<20>,
        reorderLevel: body.reorderLevel ?? company.defaultReorderLevel,
        unitCostCents: body.unitCostCents,
        sellingPriceCents: body.sellingPriceCents ?? null,
      });
      await tx.orm.public.LocationStock.create({
        companyId,
        locationId,
        itemId: item.id,
        openingStock: body.openingStock,
      });
      if (generated) await tx.orm.public.Company.where({ id: companyId }).update({ nextSkuNumber: generated.next });
      await this.audit(tx, actor, 'inventory.item_created', 'inventory_item', item.id, {
        sku,
        name: item.name,
        unitCostCents: item.unitCostCents,
        sellingPriceCents: item.sellingPriceCents,
        locationId,
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
      const company = await tx.orm.public.Company.first({ id: companyId });
      if (!company) throw new UnauthorizedException('Business no longer exists');
      const locationId = body.locationId ?? company.defaultLocationId;
      if (!locationId) throw new BadRequestException('Choose an opening location or set a default in Inventory settings');
      this.knownLocation(scope.locations, locationId);

      const normalized = body.rows.map((row) => ({ ...row, sku: row.sku?.trim().toUpperCase() }));
      const duplicateInFile = normalized.find((row, index) => row.sku && normalized.findIndex((candidate) => candidate.sku === row.sku) !== index);
      if (duplicateInFile?.sku) throw new ConflictException(`Item code ${duplicateInFile.sku} appears more than once in the spreadsheet`);
      const existingSkus = new Set(scope.items.map((item) => item.sku.toUpperCase()));
      const existing = normalized.find((row) => row.sku && existingSkus.has(row.sku));
      if (existing?.sku) throw new ConflictException(`Item code ${existing.sku} already exists`);
      const usedSkus = new Set(existingSkus);
      let nextSkuNumber = company.nextSkuNumber;
      const rows = normalized.map((row) => {
        const generated = row.sku ? null : this.availableSequentialSku(company.skuPrefix, nextSkuNumber, usedSkus);
        const sku = row.sku ?? generated!.sku;
        if (generated) nextSkuNumber = generated.next;
        usedSkus.add(sku);
        return { ...row, sku };
      });

      for (const row of rows) {
        const item = await tx.orm.public.InventoryItem.create({
          companyId,
          sku: row.sku as Varchar<40>,
          name: row.name.trim() as Varchar<120>,
          category: row.category.trim() as Varchar<80>,
          unit: (row.unit?.trim() || company.defaultUnit) as Varchar<20>,
          reorderLevel: row.reorderLevel ?? company.defaultReorderLevel,
          unitCostCents: row.unitCostCents,
          sellingPriceCents: row.sellingPriceCents ?? null,
        });
        await tx.orm.public.LocationStock.create({
          companyId,
          locationId,
          itemId: item.id,
          openingStock: row.openingStock,
        });
      }
      if (nextSkuNumber !== company.nextSkuNumber) {
        await tx.orm.public.Company.where({ id: companyId }).update({ nextSkuNumber });
      }
      await this.audit(tx, actor, 'inventory.items_imported', 'location', locationId, {
        imported: rows.length,
        skus: rows.map((row) => row.sku),
        fileName: body.fileName?.trim() || null,
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
      if ((body.unit !== undefined && body.unit.trim() !== item.unit) || (body.unitCostCents !== undefined && body.unitCostCents !== item.unitCostCents)) await assertLegacyItem(tx,companyId,itemId);
      const sku = body.sku?.trim().toUpperCase();
      if (sku && sku !== item.sku) {
        const duplicate = await tx.orm.public.InventoryItem.first({ companyId, sku: sku as Varchar<40> });
        if (duplicate) throw new ConflictException(`Item code ${sku} already exists`);
      }
      if (body.isActive === false && item.isActive) {
        const scope = await this.scope(tx, companyId, itemId);
        // Check each place: +5 here and -5 there must not pass as zero on hand.
        const stillHeld = buildSnapshot(scope.items, scope.locations, scope.stocks, scope.movements).positions
          .some((position) => position.closing !== 0);
        if (stillHeld) throw new ConflictException('Move or count this item down to zero before archiving it');
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
        ...(body.email !== undefined ? { email: body.email.trim() ? body.email.trim().toLowerCase() as Varchar<255> : null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone.trim() ? body.phone.trim() as Varchar<40> : null } : {}),
        ...(body.address !== undefined ? { address: body.address.trim() ? body.address.trim() as Varchar<300> : null } : {}),
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
      await assertLegacyItem(tx,companyId,body.itemId);
      const scope = await this.scope(tx, companyId, body.itemId);
      const item = scope.items[0];
      if (!item || !item.isActive) throw new NotFoundException('Inventory item not found');
      this.knownLocation(scope.locations, body.locationId);
      // A backdated count compares against the ledger on its own date, not today's balance.
      const ledgerAtCount = scope.movements.filter((movement) => movement.movementDate <= body.countedAt);
      const expectedQuantity = buildSnapshot(scope.items, scope.locations, scope.stocks, ledgerAtCount, 30, body.locationId)
        .positions.find((position) => position.item.id === body.itemId)?.closing ?? 0;
      const varianceQuantity = body.countedQuantity - expectedQuantity;
      const company = await tx.orm.public.Company.first({ id: companyId });
      if (!company) throw new UnauthorizedException('Business no longer exists');
      if (varianceQuantity !== 0 && company.requireAdjustmentReason && !body.note?.trim()) {
        throw new BadRequestException('Add a reason for this stock adjustment');
      }
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
      // Exact count portions carry the true cent allocation. Preserve old fields and history.
      const exactImpacts = await tx.query(this.prisma.client.raw.sql`
        SELECT m.stock_count_id AS "stockCountId", sum(e.value_delta_cents)::integer AS "valueImpactCents"
        FROM public.inventory_valuation_entries e
        JOIN public.stock_movements m ON m.company_id=e.company_id AND m.id=e.movement_id
        WHERE e.company_id=${companyId}::uuid AND m.stock_count_id IS NOT NULL
          AND e.kind IN ('count_in','count_out')
        GROUP BY m.stock_count_id
      `.returnsRow({stockCountId:'pg/uuid@1',valueImpactCents:'pg/int4@1'}).build());
      const impactByCount = new Map(exactImpacts.map(row => [row.stockCountId,row.valueImpactCents]));
      return counts.sort((left, right) => right.countedAt.localeCompare(left.countedAt) || right.createdAt.localeCompare(left.createdAt)).map((count) => ({
        ...count,
        ...(impactByCount.has(count.id) ? {valueImpactCents:impactByCount.get(count.id)} : {}),
        item: items.find((item) => item.id === count.itemId) ?? null,
        location: locations.find((location) => location.id === count.locationId) ?? null,
      }));
    });
  }

  async profitability(userId: string, companyId: string, query: ProfitabilityQueryDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, companyId, userId);
      this.assertAdministrator(actor);
      const scope = await this.scope(tx, companyId);
      const locationId = this.visibleLocation(actor, scope.locations, query.locationId);
      const location = locationId ? scope.locations.find((candidate) => candidate.id === locationId) : null;
      if (location && query.locationType && location.type !== query.locationType) {
        throw new BadRequestException('The selected place does not match the location type');
      }
      if (query.itemId && !scope.items.some((item) => item.id === query.itemId)) {
        throw new NotFoundException('Inventory item not found');
      }
      const discounts = await tx.query(this.prisma.client.raw.sql`
        SELECT s.location_id AS "locationId", l.item_id AS "itemId", s.movement_date::text AS "movementDate", l.automatic_discount_cents AS "discountCents"
        FROM public.sale_lines l
        JOIN public.sales s ON s.company_id = l.company_id AND s.id = l.sale_id
        WHERE l.company_id = ${companyId}::uuid AND l.automatic_discount_cents > 0
      `.returnsRow({ locationId: 'pg/uuid@1', itemId: 'pg/uuid@1', movementDate: 'pg/text@1', discountCents: 'pg/int4@1' }).build());
      return buildProfitability(scope.items, scope.locations, scope.movements, {
        days: query.days,
        locationId,
        locationType: query.locationType ?? null,
        itemId: query.itemId ?? null,
        category: query.category?.trim() || null,
      }, new Date(), discounts);
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
      await assertLegacyItem(tx,companyId,body.itemId);
      return this.recordMovement(tx, actor, body);
    });
  }

  private async recordMovement(tx: PrismaTransaction, actor: Actor, body: CreateMovementDto) {
    const scope = await this.scope(tx, actor.companyId, body.itemId);
    const company = await tx.orm.public.Company.first({ id: actor.companyId });
    if (!company) throw new UnauthorizedException('Business no longer exists');
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
    if (body.type === StockMovementType.PURCHASE && company.requirePurchaseSource && !body.supplierId && !body.reference?.trim()) {
      throw new BadRequestException('Choose a supplier or add a purchase reference');
    }
    if (body.type === StockMovementType.DAMAGE && company.requireAdjustmentReason && !body.note?.trim()) {
      throw new BadRequestException('Add a reason for damaged stock');
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
      if (await tx.orm.public.SaleComponent.first({ companyId: actor.companyId, movementId: sale.id })) {
        throw new ConflictException('Grouped sale returns require the original-allocation return workflow, which is not enabled yet');
      }
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

    if (!company.allowNegativeStock && MOVEMENT_SIGN[body.type] === -1) {
      // A backdated outbound movement must fit every balance from its date onward.
      const available = Math.max(0, lowestBalanceFrom(scope.stocks, scope.movements, body.itemId, locationId, body.movementDate));
      if (body.quantity > available) {
        throw new ConflictException(`Only ${available} ${item.unit} available`);
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
      await assertLegacyItem(tx,companyId,target.itemId);
      return this.removeMovement(tx, actor, id, target.itemId);
    });
  }

  private async removeMovement(tx: PrismaTransaction, actor: Actor, id: string, itemId: string) {
    const scope = await this.scope(tx, actor.companyId, itemId);
    const movement = scope.movements.find((candidate) => candidate.id === id);
    if (!movement) throw new NotFoundException('Stock movement not found');

    if (await tx.orm.public.SaleComponent.first({ companyId: actor.companyId, movementId: id })) {
      throw new ConflictException('Completed grouped sales cannot be deleted. An audited reversal is required');
    }
    if (await tx.orm.public.SaleReturnAllocation.first({companyId:actor.companyId,returnMovementId:id}) || await tx.orm.public.SaleReturnAllocation.first({companyId:actor.companyId,lossMovementId:id}) || await tx.orm.public.SaleReturnAllocation.first({companyId:actor.companyId,originalMovementId:id})) throw new ConflictException('Return allocations and their original records cannot be deleted. Record an audited correction');
    const remaining = scope.movements.filter((candidate) => candidate.id !== id);
    const affected = [movement.locationId, movement.destinationLocationId].filter((locationId): locationId is string => Boolean(locationId));
    for (const locationId of affected) {
      // Removing a receipt can strand an earlier sale even when today's balance stays positive.
      const lowestBefore = lowestBalanceFrom(scope.stocks, scope.movements, itemId, locationId, '');
      const lowestAfter = lowestBalanceFrom(scope.stocks, remaining, itemId, locationId, '');
      if (lowestAfter < 0 && lowestAfter < lowestBefore) throw new ConflictException('Later movements depend on this stock');
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

  private availableSequentialSku(prefix: string, next: number, usedSkus: ReadonlySet<string>) {
    const stem = prefix.toUpperCase();
    let sequence = next;
    let candidate = `${stem}-${String(sequence).padStart(4, '0')}`;
    while (usedSkus.has(candidate)) {
      sequence += 1;
      candidate = `${stem}-${String(sequence).padStart(4, '0')}`;
    }
    return { sku: candidate, next: sequence + 1 };
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
    // One joined read, narrowed to the item when the caller locked one.
    const componentRow = { movementId: 'pg/uuid@1', saleLineId: 'pg/uuid@1', saleId: 'pg/uuid@1', category: 'pg/text@1' } as const;
    const components = await tx.query(itemId
      ? this.prisma.client.raw.sql`
        SELECT c.movement_id AS "movementId", c.sale_line_id AS "saleLineId", l.sale_id AS "saleId", c.category::text AS category
        FROM public.sale_components c
        JOIN public.sale_lines l ON l.company_id = c.company_id AND l.id = c.sale_line_id
        WHERE c.company_id = ${companyId}::uuid AND l.item_id = ${itemId}::uuid
      `.returnsRow(componentRow).build()
      : this.prisma.client.raw.sql`
        SELECT c.movement_id AS "movementId", c.sale_line_id AS "saleLineId", l.sale_id AS "saleId", c.category::text AS category
        FROM public.sale_components c
        JOIN public.sale_lines l ON l.company_id = c.company_id AND l.id = c.sale_line_id
        WHERE c.company_id = ${companyId}::uuid
      `.returnsRow(componentRow).build());
    const componentByMovement = new Map(components.map((part) => [part.movementId, part]));
    const groupedMovements = movements.map((movement) => {
      const component = componentByMovement.get(movement.id);
      return component ? { ...movement, saleId: component.saleId, saleLineId: component.saleLineId, pricingCategory: component.category } : movement;
    });
    return {
      items: items as ItemRecord[],
      locations: locations.map((location) => this.presentLocation(location)),
      stocks: stocks as StockRecord[],
      movements: groupedMovements as MovementRecord[],
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
