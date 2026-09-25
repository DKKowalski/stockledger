import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import { buildSnapshot, type ItemRecord, type LocationRecord, type MovementRecord, type StockRecord } from '../inventory/inventory-calculations.js';
import { toCsv, type CsvValue } from './csv.js';
import { DataExportType, type DataExport } from './data-export.types.js';

@Injectable()
export class DataExportService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, companyId: string, type: DataExportType): Promise<DataExport> {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await tx.orm.public.User.first({ id: userId, companyId });
      if (!actor || actor.isActive === false) throw new UnauthorizedException('Account is not available');
      if (actor.role !== 'administrator') throw new ForbiddenException('Only an administrator can export business data');

      const company = await tx.orm.public.Company.first({ id: companyId });
      if (!company) throw new UnauthorizedException('Business no longer exists');

      const generatedAt = new Date();
      let csv: string;
      let rowCount: number;

      if (type === DataExportType.INVENTORY) {
        const result = await this.inventory(tx, companyId, company.currency, generatedAt);
        csv = result.csv;
        rowCount = result.rowCount;
      } else if (type === DataExportType.MOVEMENTS) {
        const result = await this.movements(tx, companyId, company.currency);
        csv = result.csv;
        rowCount = result.rowCount;
      } else {
        const result = await this.activity(tx, companyId);
        csv = result.csv;
        rowCount = result.rowCount;
      }

      await tx.orm.public.AuditEvent.create({
        companyId,
        actorUserId: actor.id,
        action: 'data.exported' as Varchar<80>,
        entityType: 'company' as Varchar<80>,
        entityId: companyId,
        metadata: { type, rowCount },
      });

      return {
        filename: `stockledger-${type}-${generatedAt.toISOString().slice(0, 10)}.csv`,
        csv,
      };
    });
  }

  private async inventory(tx: PrismaTransaction, companyId: string, currency: string, now: Date) {
    const [items, locations, stocks, movements] = await Promise.all([
      tx.orm.public.InventoryItem.where({ companyId }).all(),
      tx.orm.public.Location.where({ companyId }).all(),
      tx.orm.public.LocationStock.where({ companyId }).all(),
      tx.orm.public.StockMovement.where({ companyId }).all(),
    ]);
    const itemRecords = items as ItemRecord[];
    const locationRecords = locations as LocationRecord[];
    const stockRecords = stocks as StockRecord[];
    const movementRecords = movements as MovementRecord[];
    const assigned = new Set(stockRecords.map((stock) => `${stock.locationId}:${stock.itemId}`));
    const touched = new Set(movementRecords.flatMap((movement) => [
      `${movement.locationId}:${movement.itemId}`,
      ...(movement.destinationLocationId ? [`${movement.destinationLocationId}:${movement.itemId}`] : []),
    ]));
    const positions = locationRecords.flatMap((location) => (
      buildSnapshot(itemRecords, locationRecords, stockRecords, movementRecords, 30, location.id, now).positions
        .filter((position) => assigned.has(`${location.id}:${position.item.id}`) || touched.has(`${location.id}:${position.item.id}`))
    ));
    const rows: CsvValue[][] = positions.map((position) => [
      position.item.sku,
      position.item.name,
      position.item.category,
      position.item.unit,
      position.location.name,
      position.location.type,
      position.opening,
      position.purchases,
      position.returnsIn,
      position.transferredIn,
      position.transferredOut,
      position.returnsOut,
      position.damaged,
      position.sales,
      position.closing,
      position.item.reorderLevel,
      position.isLowStock,
      position.item.unitCostCents,
      money(position.item.unitCostCents, currency),
      position.item.sellingPriceCents,
      money(position.item.sellingPriceCents, currency),
      position.valueCents,
      money(position.valueCents, currency),
      currency,
    ]);
    return {
      rowCount: rows.length,
      csv: toCsv([
        'SKU', 'Item name', 'Category', 'Unit', 'Place', 'Place type', 'Opening stock', 'Purchases',
        'Returns in', 'Transfers in', 'Transfers out', 'Returns out', 'Damaged', 'Sales', 'Closing stock',
        'Reorder level', 'Low stock', 'Unit cost (minor units)', 'Unit cost', 'Selling price (minor units)',
        'Selling price', 'Stock value (minor units)', 'Stock value', 'Currency',
      ], rows),
    };
  }

  private async movements(tx: PrismaTransaction, companyId: string, currency: string) {
    const [items, locations, movements] = await Promise.all([
      tx.orm.public.InventoryItem.where({ companyId }).all(),
      tx.orm.public.Location.where({ companyId }).all(),
      tx.orm.public.StockMovement.where({ companyId }).all(),
    ]);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const sorted = [...movements].sort((left, right) => (
      right.movementDate.localeCompare(left.movementDate) || right.createdAt.localeCompare(left.createdAt)
    ));
    const rows: CsvValue[][] = sorted.map((movement) => {
      const item = itemById.get(movement.itemId);
      const unitPrice = movement.unitPriceCents;
      const saleTotal = unitPrice === null ? null : unitPrice * movement.quantity;
      return [
        movement.movementDate,
        movement.createdAt,
        movement.type,
        item?.sku ?? '',
        item?.name ?? '',
        locationById.get(movement.locationId)?.name ?? '',
        movement.destinationLocationId ? locationById.get(movement.destinationLocationId)?.name ?? '' : '',
        movement.quantity,
        movement.reference,
        movement.note,
        unitPrice,
        money(unitPrice, currency),
        saleTotal,
        money(saleTotal, currency),
        currency,
      ];
    });
    return {
      rowCount: rows.length,
      csv: toCsv([
        'Movement date', 'Recorded at', 'Type', 'SKU', 'Item name', 'Source place', 'Destination place',
        'Quantity', 'Reference', 'Note', 'Sale unit price (minor units)', 'Sale unit price',
        'Sale total (minor units)', 'Sale total', 'Currency',
      ], rows),
    };
  }

  private async activity(tx: PrismaTransaction, companyId: string) {
    const events = await tx.orm.public.AuditEvent
      .where({ companyId })
      .include('actor', (users) => users.select('fullName', 'email'))
      .orderBy([(event) => event.createdAt.desc(), (event) => event.id.desc()])
      .all();
    const rows: CsvValue[][] = events.map((event) => [
      event.createdAt,
      event.actor?.fullName ?? 'System',
      event.actor?.email ?? '',
      event.action,
      event.entityType,
      event.entityId,
      JSON.stringify(event.metadata),
    ]);
    return {
      rowCount: rows.length,
      csv: toCsv(['Recorded at', 'Actor', 'Actor email', 'Action', 'Entity type', 'Entity ID', 'Details'], rows),
    };
  }
}

function money(cents: number | null, currency: string) {
  return cents === null ? '' : `${currency} ${(cents / 100).toFixed(2)}`;
}
