import 'dotenv/config';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import * as argon2 from 'argon2';
import { validatePricingRules, type PricingRules } from '../modules/inventory/pricing-calculations.js';
import { db } from './db.js';

// The demo workspace is a realistic Accra provisions business, including box and bulk deals.
// Every ID is fixed, so running the seed again updates the same records instead of duplicating them.
const DEMO_EMAIL = 'admin@stockledger.app';
const DEMO_PASSWORD = 'StockLedger123!';
const MANAGER_EMAIL = 'messien@stockledger.app';
const ATTENDANT_EMAIL = 'jbaidoo@stockledger.app';
const COMPANY_ID = '31000000-0000-4000-8000-000000000001';
const ADMIN_ID = '41000000-0000-4000-8000-000000000001';
const WAREHOUSE_ID = '32000000-0000-4000-8000-000000000001';
const MAKOLA_ID = '32000000-0000-4000-8000-000000000002';
const OSU_ID = '32000000-0000-4000-8000-000000000003';

const id = (group: string, n: number) => `${group}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SUPPLIERS = { voltic: id('81', 1), nestle: id('81', 2), wilmar: id('81', 3), olam: id('81', 4), unilever: id('81', 5) };

type Product = {
  key: string; sku: string; name: string; category: string; unit: string;
  reorder: number; cost: number; price: number; opening: number;
  pricing?: PricingRules;
};

const products: Product[] = [
  { key: 'voltic', sku: 'ADM-0001', name: 'Voltic Mineral Water 500ml', category: 'Drinks', unit: 'bottle', reorder: 120, cost: 150, price: 250, opening: 1200,
    pricing: { package: { label: 'pack', size: 12, priceCents: 2700 }, bulkTiers: [{ minimumQuantity: 6, unitPriceCents: 240 }] } },
  { key: 'milo', sku: 'ADM-0002', name: 'Milo 400g Tin', category: 'Beverages', unit: 'tin', reorder: 30, cost: 3200, price: 4200, opening: 240,
    pricing: { package: { label: 'carton', size: 24, priceCents: 96000 }, bulkTiers: [{ minimumQuantity: 6, unitPriceCents: 4100 }] } },
  { key: 'frytol', sku: 'ADM-0003', name: 'Frytol Cooking Oil 1L', category: 'Cooking', unit: 'bottle', reorder: 40, cost: 2600, price: 3400, opening: 300,
    pricing: { package: { label: 'carton', size: 12, priceCents: 38400 }, bulkTiers: [] } },
  { key: 'gino', sku: 'ADM-0004', name: 'Gino Tomato Paste 70g', category: 'Cooking', unit: 'sachet', reorder: 200, cost: 90, price: 150, opening: 2000,
    pricing: { package: { label: 'carton', size: 50, priceCents: 6500 }, bulkTiers: [{ minimumQuantity: 20, unitPriceCents: 140 }] } },
  { key: 'rice', sku: 'ADM-0005', name: 'Royal Aroma Rice 5kg', category: 'Grains', unit: 'bag', reorder: 15, cost: 9500, price: 12000, opening: 160,
    pricing: { package: null, bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 11500 }, { minimumQuantity: 10, unitPriceCents: 11000 }] } },
  { key: 'ideal', sku: 'ADM-0006', name: 'Ideal Milk 160g', category: 'Beverages', unit: 'tin', reorder: 60, cost: 650, price: 900, opening: 480,
    pricing: { package: { label: 'carton', size: 48, priceCents: 40800 }, bulkTiers: [] } },
  { key: 'sunlight', sku: 'ADM-0007', name: 'Sunlight Detergent 900g', category: 'Household', unit: 'pack', reorder: 20, cost: 2200, price: 2900, opening: 150 },
  { key: 'keysoap', sku: 'ADM-0008', name: 'Key Soap Bar', category: 'Household', unit: 'bar', reorder: 80, cost: 450, price: 700, opening: 600,
    pricing: { package: { label: 'box', size: 36, priceCents: 23400 }, bulkTiers: [] } },
];
// The first five keep the demo's original item IDs so existing references stay valid.
const itemId = (key: string) => id('51', products.findIndex((product) => product.key === key) + 1);
const product = (key: string) => products.find((candidate) => candidate.key === key)!;

const day = (offset: number) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

// [item, type, quantity, days ago, from, to, reference, supplier, note]
type MovementRow = [string, 'purchase' | 'transfer' | 'sale' | 'damage', number, number, string, string | null, string, string | null, string?];
const movements: MovementRow[] = [
  ['voltic', 'purchase', 600, -20, WAREHOUSE_ID, null, 'PO-2041', SUPPLIERS.voltic],
  ['milo', 'purchase', 120, -18, WAREHOUSE_ID, null, 'PO-2042', SUPPLIERS.nestle],
  ['frytol', 'purchase', 120, -15, WAREHOUSE_ID, null, 'PO-2043', SUPPLIERS.wilmar],
  ['rice', 'purchase', 60, -14, WAREHOUSE_ID, null, 'PO-2044', SUPPLIERS.olam],
  ['voltic', 'transfer', 480, -12, WAREHOUSE_ID, MAKOLA_ID, 'TRF-310', null],
  ['milo', 'transfer', 60, -12, WAREHOUSE_ID, MAKOLA_ID, 'TRF-311', null],
  ['frytol', 'transfer', 96, -11, WAREHOUSE_ID, MAKOLA_ID, 'TRF-312', null],
  ['gino', 'transfer', 600, -11, WAREHOUSE_ID, MAKOLA_ID, 'TRF-313', null],
  ['rice', 'transfer', 40, -11, WAREHOUSE_ID, MAKOLA_ID, 'TRF-314', null],
  ['ideal', 'transfer', 192, -10, WAREHOUSE_ID, MAKOLA_ID, 'TRF-315', null],
  ['sunlight', 'transfer', 48, -10, WAREHOUSE_ID, MAKOLA_ID, 'TRF-316', null],
  ['keysoap', 'transfer', 240, -10, WAREHOUSE_ID, MAKOLA_ID, 'TRF-317', null],
  ['voltic', 'transfer', 240, -9, WAREHOUSE_ID, OSU_ID, 'TRF-318', null],
  ['milo', 'transfer', 24, -9, WAREHOUSE_ID, OSU_ID, 'TRF-319', null],
  ['frytol', 'transfer', 24, -8, WAREHOUSE_ID, OSU_ID, 'TRF-320', null],
  ['gino', 'transfer', 300, -8, WAREHOUSE_ID, OSU_ID, 'TRF-321', null],
  ['rice', 'transfer', 15, -8, WAREHOUSE_ID, OSU_ID, 'TRF-322', null],
  ['ideal', 'transfer', 96, -8, WAREHOUSE_ID, OSU_ID, 'TRF-323', null],
  ['keysoap', 'transfer', 96, -8, WAREHOUSE_ID, OSU_ID, 'TRF-324', null],
  ['frytol', 'damage', 6, -7, WAREHOUSE_ID, null, 'DMG-051', null, 'Leaking bottles found in carton'],
  ['voltic', 'sale', 120, -6, MAKOLA_ID, null, 'SALE-8801', null],
  ['milo', 'sale', 14, -6, MAKOLA_ID, null, 'SALE-8802', null],
  ['gino', 'sale', 150, -5, MAKOLA_ID, null, 'SALE-8803', null],
  ['rice', 'sale', 9, -5, MAKOLA_ID, null, 'SALE-8804', null],
  ['frytol', 'sale', 22, -4, MAKOLA_ID, null, 'SALE-8805', null],
  ['voltic', 'sale', 96, -4, MAKOLA_ID, null, 'SALE-8806', null],
  ['ideal', 'sale', 52, -3, MAKOLA_ID, null, 'SALE-8807', null],
  ['keysoap', 'sale', 64, -3, MAKOLA_ID, null, 'SALE-8808', null],
  ['milo', 'sale', 24, -2, MAKOLA_ID, null, 'SALE-8809', null],
  ['gino', 'sale', 220, -2, MAKOLA_ID, null, 'SALE-8810', null],
  ['sunlight', 'sale', 20, -2, MAKOLA_ID, null, 'SALE-8811', null],
  ['voltic', 'sale', 96, -1, MAKOLA_ID, null, 'SALE-8812', null],
  ['frytol', 'sale', 28, -1, MAKOLA_ID, null, 'SALE-8813', null],
  ['rice', 'sale', 13, -1, MAKOLA_ID, null, 'SALE-8814', null],
  ['ideal', 'sale', 48, -1, MAKOLA_ID, null, 'SALE-8815', null],
  ['keysoap', 'sale', 56, -1, MAKOLA_ID, null, 'SALE-8816', null],
  ['voltic', 'sale', 60, -5, OSU_ID, null, 'SALE-9101', null],
  ['gino', 'sale', 90, -4, OSU_ID, null, 'SALE-9102', null],
  ['ideal', 'sale', 30, -3, OSU_ID, null, 'SALE-9103', null],
  ['keysoap', 'sale', 28, -3, OSU_ID, null, 'SALE-9104', null],
  ['frytol', 'sale', 8, -2, OSU_ID, null, 'SALE-9105', null],
  ['rice', 'sale', 6, -2, OSU_ID, null, 'SALE-9106', null],
  ['milo', 'sale', 10, -1, OSU_ID, null, 'SALE-9107', null],
];

const varchar = <Length extends number>(value: string) => value as Varchar<Length>;

async function seed() {
  for (const item of products) if (item.pricing) validatePricingRules(item.price, item.pricing);
  const passwordHash = varchar<255>(await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }));
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    const company = {
      name: varchar<120>('Adom Provisions'),
      businessType: varchar<40>('mixed'),
      inventorySource: varchar<40>('spreadsheet'),
      contactEmail: varchar<255>(DEMO_EMAIL),
      phone: varchar<40>('+233 30 222 4410'),
      address: varchar<300>('Kaneshie Industrial Area, Accra'),
      skuPrefix: varchar<12>('ADM'),
      nextSkuNumber: products.length + 1,
      onboardingCompletedAt: now,
      hybridPricingEnabled: true,
    };
    await tx.orm.public.Company.upsert({ create: { id: COMPANY_ID, ...company }, update: company });

    for (const [placeId, name, type] of [
      [WAREHOUSE_ID, 'Kaneshie warehouse', 'warehouse'],
      [MAKOLA_ID, 'Makola shop', 'shop'],
      [OSU_ID, 'Osu shop', 'shop'],
    ] as const) {
      const values = { companyId: COMPANY_ID, name: varchar<120>(name), type };
      await tx.orm.public.Location.upsert({ create: { id: placeId, ...values }, update: values });
    }
    await tx.orm.public.Company.where({ id: COMPANY_ID }).update({ defaultLocationId: WAREHOUSE_ID });

    const admin = {
      companyId: COMPANY_ID, fullName: varchar<120>('Eric Mensah'), email: varchar<255>(DEMO_EMAIL),
      passwordHash, role: 'administrator' as const, emailVerifiedAt: now,
    };
    await tx.orm.public.User.upsert({ create: { id: ADMIN_ID, ...admin }, update: admin });
    // The manager and attendant may already exist with app-generated IDs, so they are matched by email.
    for (const [userId, fullName, email, role, locationId] of [
      [id('42', 1), 'Michael Essien', MANAGER_EMAIL, 'inventory_manager', null],
      [id('42', 2), 'Joyce Baidoo', ATTENDANT_EMAIL, 'shop_attendant', MAKOLA_ID],
    ] as const) {
      const values = { fullName: varchar<120>(fullName), passwordHash, role, locationId, isActive: true, emailVerifiedAt: now, invitationAcceptedAt: now };
      if (await tx.orm.public.User.first({ companyId: COMPANY_ID, email: varchar<255>(email) })) {
        await tx.orm.public.User.where({ companyId: COMPANY_ID, email: varchar<255>(email) }).update(values);
      } else {
        await tx.orm.public.User.create({ id: userId, companyId: COMPANY_ID, email: varchar<255>(email), ...values });
      }
    }

    for (const [supplierId, name, phone] of [
      [SUPPLIERS.voltic, 'Voltic (GH) Limited', '+233 30 281 2000'],
      [SUPPLIERS.nestle, 'Nestlé Ghana Distribution', '+233 30 221 5560'],
      [SUPPLIERS.wilmar, 'Wilmar Africa Limited', '+233 30 340 1900'],
      [SUPPLIERS.olam, 'Olam Ghana Rice', '+233 30 277 6024'],
      [SUPPLIERS.unilever, 'Unilever Ghana', '+233 30 221 6110'],
    ] as const) {
      const values = { companyId: COMPANY_ID, name: varchar<120>(name), phone: varchar<40>(phone), isActive: true };
      await tx.orm.public.Supplier.upsert({ create: { id: supplierId, ...values }, update: values });
    }

    for (const [index, item] of products.entries()) {
      const values = {
        companyId: COMPANY_ID, sku: varchar<40>(item.sku), name: varchar<120>(item.name), category: varchar<80>(item.category),
        unit: varchar<20>(item.unit), reorderLevel: item.reorder, unitCostCents: item.cost, sellingPriceCents: item.price, isActive: true,
      };
      await tx.orm.public.InventoryItem.upsert({ create: { id: itemId(item.key), ...values }, update: values });
      await tx.orm.public.LocationStock.upsert({
        create: { id: id('71', index + 1), companyId: COMPANY_ID, locationId: WAREHOUSE_ID, itemId: itemId(item.key), openingStock: item.opening },
        update: { openingStock: item.opening },
        conflictOn: { companyId: COMPANY_ID, locationId: WAREHOUSE_ID, itemId: itemId(item.key) },
      });
      // Pricing versions are append-only, so a rerun keeps the first saved version.
      if (item.pricing && !(await tx.orm.public.ItemPricingVersion.first({ companyId: COMPANY_ID, itemId: itemId(item.key), version: 1 }))) {
        await tx.orm.public.ItemPricingVersion.create({
          id: id('91', index + 1), companyId: COMPANY_ID, itemId: itemId(item.key), version: 1,
          baseUnit: varchar<20>(item.unit), previewEnabled: true,
          packageLabel: item.pricing.package ? varchar<20>(item.pricing.package.label) : null,
          packageSize: item.pricing.package?.size ?? null,
          packagePriceCents: item.pricing.package?.priceCents ?? null,
          bulkTiers: item.pricing.bulkTiers.map((tier) => ({ ...tier })),
          createdByUserId: ADMIN_ID,
        });
      }
    }

    for (const [index, [key, type, quantity, offset, from, to, reference, supplierId, note]] of movements.entries()) {
      const item = product(key);
      const values = {
        itemId: itemId(key), locationId: from, destinationLocationId: to, type, quantity, movementDate: day(offset),
        unitPriceCents: type === 'sale' ? item.price : null, unitCostCents: item.cost, supplierId,
        relatedMovementId: null, reference: varchar<80>(reference), note: note ? varchar<500>(note) : null,
      };
      await tx.orm.public.StockMovement.upsert({ create: { id: id('61', index + 1), companyId: COMPANY_ID, ...values }, update: values });
    }
  });
  console.log(`Seeded the demo workspace: ${products.length} items, ${movements.length} movements.`);
  console.log(`Demo logins (password ${DEMO_PASSWORD}): owner ${DEMO_EMAIL}, manager ${MANAGER_EMAIL}, Makola attendant ${ATTENDANT_EMAIL}`);
}

try {
  await seed();
} finally {
  await db.close();
}
