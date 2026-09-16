import 'dotenv/config';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import * as argon2 from 'argon2';
import { db } from './db.js';

const DEMO_EMAIL = 'admin@stockledger.app';
const DEMO_PASSWORD = 'StockLedger123!';

const items = [
  ['51000000-0000-4000-8000-000000000001', 'SKU-1001', 'Basmati Rice 5kg', 'Grocery', 'bag', 40, 1250, 180],
  ['51000000-0000-4000-8000-000000000002', 'SKU-1002', 'Sunflower Oil 1L', 'Grocery', 'btl', 60, 320, 240],
  ['51000000-0000-4000-8000-000000000003', 'SKU-1003', 'Detergent Powder 2kg', 'Household', 'pack', 30, 675, 90],
  ['51000000-0000-4000-8000-000000000004', 'SKU-1004', 'LED Bulb 9W', 'Electrical', 'pcs', 50, 190, 150],
  ['51000000-0000-4000-8000-000000000005', 'SKU-1005', 'Steel Water Bottle', 'Kitchenware', 'pcs', 20, 550, 40],
] as const;

const day = (offset: number) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

const movements = [
  ['61000000-0000-4000-8000-000000000001', items[0][0], 'purchase', 200, -28, 'PO-1001', null],
  ['61000000-0000-4000-8000-000000000002', items[0][0], 'transfer', 65, -20, 'TRF-1001', null],
  ['61000000-0000-4000-8000-000000000003', items[0][0], 'return_in', 10, -9, 'RET-1001', 'Shop overstock returned'],
  ['61000000-0000-4000-8000-000000000004', items[1][0], 'purchase', 120, -22, 'PO-1002', null],
  ['61000000-0000-4000-8000-000000000005', items[1][0], 'transfer', 90, -12, 'TRF-1002', null],
  ['61000000-0000-4000-8000-000000000006', items[1][0], 'damage', 14, -5, 'DMG-1001', 'Leaking bottles'],
  ['61000000-0000-4000-8000-000000000007', items[2][0], 'transfer', 18, -18, 'TRF-1003', null],
  ['61000000-0000-4000-8000-000000000008', items[3][0], 'transfer', 12, -6, 'TRF-1004', null],
  ['61000000-0000-4000-8000-000000000009', items[3][0], 'damage', 6, -4, 'DMG-1002', 'Broken in transit'],
  ['61000000-0000-4000-8000-000000000010', items[4][0], 'purchase', 25, -90, 'PO-1005', null],
] as const;

const varchar = <Length extends number>(value: string) => value as Varchar<Length>;

async function seed() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  await db.transaction(async (tx) => {
    await tx.orm.public.User.upsert({
      create: {
        id: '41000000-0000-4000-8000-000000000001',
        fullName: varchar<120>('Eric Mensah'),
        email: varchar<255>(DEMO_EMAIL),
        passwordHash: varchar<255>(passwordHash),
        role: 'administrator',
      },
      update: {
        fullName: varchar<120>('Eric Mensah'),
        email: varchar<255>(DEMO_EMAIL),
        passwordHash: varchar<255>(passwordHash),
        role: 'administrator',
      },
    });

    for (const [id, sku, name, category, unit, reorderLevel, unitCostCents, openingStock] of items) {
      const values = {
        sku: varchar<40>(sku),
        name: varchar<120>(name),
        category: varchar<80>(category),
        unit: varchar<20>(unit),
        reorderLevel,
        unitCostCents,
        openingStock,
      };
      await tx.orm.public.InventoryItem.upsert({ create: { id, ...values }, update: values });
    }

    for (const [id, itemId, type, quantity, offset, reference, note] of movements) {
      const values = {
        itemId,
        type,
        quantity,
        movementDate: day(offset),
        reference: varchar<80>(reference),
        note: note ? varchar<500>(note) : null,
      };
      await tx.orm.public.StockMovement.upsert({ create: { id, ...values }, update: values });
    }
  });
  console.log(`Seeded ${items.length} items and ${movements.length} movements.`);
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

try {
  await seed();
} finally {
  await db.close();
}
