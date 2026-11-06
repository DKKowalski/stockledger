import type { Page } from '@playwright/test';

export async function mediumSession(page: Page, empty = false, role = 'administrator', safeguard = false) {
  const item = { id: 'target', name: 'Milo Family Tin 400g', sku: 'MIL400', category: 'Drinks', unit: 'tin', isActive: true, sellingPriceCents: 4200, unitCostCents: 3200, reorderLevel: 10 };
  const other = { ...item, id: 'other', name: 'Water', sku: 'WATER', reorderLevel: 0 };
  const shop = { id: 'shop', name: 'Main shop', type: 'shop', isActive: true };
  const warehouse = { ...shop, id: 'warehouse', name: 'Warehouse', type: 'warehouse' };
  const position = { item, location: shop, closing: 7, opening: 10, purchases: 0, returnsIn: 0, transferredIn: 0, transferredOut: 0, returnsOut: 0, damaged: 0, sales: 3, adjustmentsIn: 0, adjustmentsOut: 0, valueCents: 22400, isLowStock: true, velocity: 'fast', outLastPeriod: 3, lastOutDate: null };
  const positions = empty ? [] : [position, { ...position, item: other, closing: 0, opening: 0, sales: 0, isLowStock: false }];
  const snapshot = { generatedAt: '2026-11-06', items: empty ? [] : [item, other], locations: [shop, warehouse], positions, movements: [], periodMovements: [], summary: { closingUnits: empty ? 0 : 7, stockValueCents: 22400, lowStockItems: empty ? 0 : 1, damagedUnits: 0, deadStockLines: 0 } };
  await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
  await page.route('http://localhost:3100/**', route => route.fulfill({ json: [] }));
  await page.route('**/auth/refresh', route => route.fulfill({ json: { accessToken: 'medium-session', user: { id: role, companyId: 'company', fullName: 'Shop staff', role, isActive: true, locationId: null, isDemo: false, setupPending: false } } }));
  await page.route('**/settings', route => route.fulfill({ json: { currency: 'GHS', timeZone: 'Africa/Accra', itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse', requirePurchaseSource: safeguard } }));
  await page.route('**/inventory/snapshot**', route => route.fulfill({ json: snapshot }));
  await page.route('**/onboarding', route => route.fulfill({ json: { completed: true, company: { name: 'Shop', inventorySource: 'starting_fresh' }, counts: { locations: 2, items: empty ? 0 : 2, movements: empty ? 0 : 1, teammates: 0 } } }));
  await page.route('**/inventory/movements?**', route => route.fulfill({ json: { movements: [], total: 0 } }));
  await page.route('**/inventory/profitability?**', route => route.fulfill({ json: { summary: { netSalesCents: 12000, grossProfitCents: 4000, costCoveragePercent: 100 } } }));
  return snapshot;
}
