import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import postgres from '@prisma/orm-postgres/runtime';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d.js';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

const url = process.env.INVENTORY_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) {
  throw new Error('HTTP integration tests require the isolated test database runner');
}
const db = postgres<Contract>({ contractJson, url });
const v = <N extends number>(value: string) => value as Varchar<N>;
const companyId = randomUUID();
const otherCompanyId = randomUUID();
const ownerId = randomUUID();
const managerId = randomUUID();
const attendantId = randomUUID();
const otherOwnerId = randomUUID();
const now = new Date();
const thisMonth = now.toISOString().slice(0, 7);
const PROFIT = '2025-03'; // 100001 cents of other revenue and nothing else
const LOSS = '2025-04';
const ZERO = '2025-05';
const FUTURE = '2099-01';
const CAPITAL = '2025-06'; // sold 2 at 1000 costing 400 each: COGS 800
const CAPITAL_LOSS = '2025-07'; // sold 1 at 100 costing 500: COGS 500 but a loss
let app: INestApplication;
let base: string;
const tokens: Record<string, string> = {};

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
}
const amounts = (body: any) => body.parts.map((part: any) => part.amountCents);

beforeAll(async () => {
  for (const [cid, name] of [[companyId, 'Split fixture'], [otherCompanyId, 'Other fixture']] as const) await db.orm.public.Company.create({ id: cid, name: v<120>(name) });
  const shop = await db.orm.public.Location.create({ companyId, name: v<120>('Shop'), type: 'shop' });
  const users = [[ownerId, companyId, 'administrator', null], [managerId, companyId, 'inventory_manager', null], [attendantId, companyId, 'shop_attendant', shop.id], [otherOwnerId, otherCompanyId, 'administrator', null]] as const;
  for (const [id, cid, role, locationId] of users) {
    await db.orm.public.User.create({ id, companyId: cid, role, locationId, fullName: v<120>(role), email: v<255>(`${id}@test.invalid`), passwordHash: v<255>('unused') });
  }
  const category = await db.orm.public.FinanceCategory.create({ companyId, name: v<80>('Rent') });
  const entry = (kind: string, entryDate: string, amountCents: number) => db.orm.public.FinanceEntry.create({ companyId, createdByUserId: ownerId, kind: v<20>(kind), categoryId: kind === 'expense' ? category.id : null, entryDate, amountCents, note: v<500>('fixture') });
  await entry('other_revenue', `${PROFIT}-10`, 100001);
  await entry('expense', `${LOSS}-10`, 500);
  await entry('other_revenue', `${thisMonth}-01`, 50000);
  const item = await db.orm.public.InventoryItem.create({ companyId, sku: v<40>('CAP'), name: v<120>('Capital item'), category: v<80>('Test'), unit: v<20>('pcs'), unitCostCents: 400, sellingPriceCents: 1000 });
  const sale = (movementDate: string, quantity: number, unitPriceCents: number, unitCostCents: number) => db.orm.public.StockMovement.create({ companyId, itemId: item.id, locationId: shop.id, type: 'sale', quantity, unitPriceCents, unitCostCents, movementDate });
  await sale(`${CAPITAL}-10`, 2, 1000, 400);
  await sale(`${CAPITAL_LOSS}-10`, 1, 100, 500);
  await sale(`${thisMonth}-01`, 1, 1000, 300);
  const { AppModule } = await import('../dist/app.module.js' as string);
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const jwt = app.get(JwtService);
  for (const [name, sub, cid, role] of [['owner', ownerId, companyId, 'administrator'], ['manager', managerId, companyId, 'inventory_manager'], ['attendant', attendantId, companyId, 'shop_attendant'], ['other', otherOwnerId, otherCompanyId, 'administrator']] as const) {
    tokens[name] = await jwt.signAsync({ sub, companyId: cid, role });
  }
});

afterAll(async () => {
  if (app) await app.close();
  await db.close();
});

describe('profit split', () => {
  it('returns the six defaults without saving anything, summing exactly to net profit', async () => {
    const result = await call(`/finance/profit-split?month=${PROFIT}`, tokens.owner!);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'complete', netProfitCents: 100001, usingDefaults: true, canComplete: true });
    expect(result.body.parts.map((part: any) => part.name)).toEqual(['Tax reserve', 'Top up emergency reserve', 'Reinvest in inventory/tools', "Pay owner's draw", 'Repay debt / clear supplier', 'Growth fund']);
    expect(result.body.parts[1].destination).toContain('Target: 1–3 months of expenses');
    expect(amounts(result.body)).toEqual([10000, 20001, 20000, 20000, 10000, 20000]);
    expect(amounts(result.body).reduce((a: number, b: number) => a + b, 0)).toBe(100001);
    expect(await db.orm.public.ProfitSplitPart.where({ companyId }).all()).toHaveLength(0);
  });

  it('uses the Finance net profit line exactly', async () => {
    const finance = await call('/finance?year=2025', tokens.owner!);
    const march = finance.body.months.find((month: any) => month.month === PROFIT);
    expect(march.lines.find((line: any) => line.key === 'net_profit').actualCents).toBe(100001);
  });

  it('shows no parts for loss, zero and future months', async () => {
    for (const month of [LOSS, ZERO, FUTURE]) {
      const result = await call(`/finance/profit-split?month=${month}`, tokens.owner!);
      expect(result.status).toBe(200);
      expect(result.body.parts).toEqual([]);
      expect(result.body.hasProfit).toBe(false);
    }
    expect((await call(`/finance/profit-split?month=${LOSS}`, tokens.owner!)).body.netProfitCents).toBe(-500);
  });

  it('rejects a bad month', async () => {
    expect((await call('/finance/profit-split?month=2025-13', tokens.owner!)).status).toBe(400);
    expect((await call('/finance/profit-split', tokens.owner!)).status).toBe(400);
  });

  it('rejects managers and attendants with 403 on every endpoint', async () => {
    const settings = { parts: [{ name: 'All', destination: 'Somewhere', percent: 100 }] };
    for (const role of ['manager', 'attendant']) {
      expect((await call(`/finance/profit-split?month=${PROFIT}`, tokens[role]!)).status).toBe(403);
      expect((await call('/finance/profit-split/settings', tokens[role]!, 'PUT', settings)).status).toBe(403);
      expect((await call(`/finance/profit-split/${PROFIT}/parts/default-1`, tokens[role]!, 'PUT', {})).status).toBe(403);
      expect((await call(`/finance/profit-split/${PROFIT}/parts/default-1`, tokens[role]!, 'DELETE')).status).toBe(403);
      expect((await call(`/finance/profit-split/${CAPITAL}/capital`, tokens[role]!, 'PUT', {})).status).toBe(403);
      expect((await call(`/finance/profit-split/${CAPITAL}/capital`, tokens[role]!, 'DELETE')).status).toBe(403);
    }
    expect(await db.orm.public.ProfitSplitCompletion.where({ companyId }).all()).toHaveLength(0);
    expect(await db.orm.public.ProfitSplitPart.where({ companyId }).all()).toHaveLength(0);
  });

  it('validates settings', async () => {
    const put = (parts: unknown) => call('/finance/profit-split/settings', tokens.owner!, 'PUT', { parts });
    const part = (percent: number, name = 'Part') => ({ name, destination: 'Dest', percent });
    expect((await put([part(50), part(49)])).status).toBe(400);
    expect((await put([])).status).toBe(400);
    expect((await put(Array.from({ length: 11 }, () => part(100 / 11)))).status).toBe(400);
    expect((await put([part(-10), part(110)])).status).toBe(400);
    expect((await put([part(0), part(100)])).status).toBe(400);
    expect((await put([part(33.333), part(66.667)])).status).toBe(400);
    expect((await put([part(50, '  '), part(50)])).status).toBe(400);
    expect(await db.orm.public.ProfitSplitPart.where({ companyId }).all()).toHaveLength(0);
  });

  it('marks a part done with a snapshot, keeps it when settings change, and flags late profit changes', async () => {
    const done = await call(`/finance/profit-split/${PROFIT}/parts/default-2`, tokens.owner!, 'PUT', { doneOn: '2025-04-02', note: 'Moved to reserve' });
    expect(done.status).toBe(200);
    expect(done.body.parts[1].completion).toMatchObject({ amountCents: 20001, percentBasisPoints: 2000, doneOn: '2025-04-02', note: 'Moved to reserve', changedSinceDone: false });
    const stored = await db.orm.public.ProfitSplitCompletion.first({ companyId });
    expect(stored).toMatchObject({ amountCents: 20001, month: '2025-03-01', partKey: 'default-2', createdByUserId: ownerId });

    // Settings change: 3 parts, keeping the default-2 key but at 50%.
    const saved = await call('/finance/profit-split/settings', tokens.owner!, 'PUT', { parts: [{ key: 'default-2', name: 'Reserve', destination: 'Reserve account', percent: 50 }, { name: 'Owner', destination: 'Personal', percent: 33.33 }, { name: 'Growth', destination: 'Savings', percent: 16.67 }] });
    expect(saved.status).toBe(200);
    const after = await call(`/finance/profit-split?month=${PROFIT}`, tokens.owner!);
    expect(after.body.usingDefaults).toBe(false);
    expect(amounts(after.body)).toEqual([50001, 33330, 16670]);
    expect(amounts(after.body).reduce((a: number, b: number) => a + b, 0)).toBe(100001);
    expect(after.body.parts[0].completion).toMatchObject({ amountCents: 20001, percentBasisPoints: 2000, changedSinceDone: true });
    expect((await db.orm.public.ProfitSplitCompletion.first({ companyId }))?.amountCents).toBe(20001);

    // A late expense changes the month's profit.
    const category = (await db.orm.public.FinanceCategory.first({ companyId }))!;
    await db.orm.public.FinanceEntry.create({ companyId, createdByUserId: ownerId, kind: v<20>('expense'), categoryId: category.id, entryDate: `${PROFIT}-20`, amountCents: 1, note: v<500>('late') });
    const late = await call(`/finance/profit-split?month=${PROFIT}`, tokens.owner!);
    expect(late.body.netProfitCents).toBe(100000);

    const undone = await call(`/finance/profit-split/${PROFIT}/parts/default-2`, tokens.owner!, 'DELETE');
    expect(undone.status).toBe(200);
    expect(undone.body.parts[0].completion).toBeNull();
    expect((await call(`/finance/profit-split/${PROFIT}/parts/default-2`, tokens.owner!, 'DELETE')).status).toBe(404);
  });

  it('rejects completion for an in-progress month, a future month, a loss month and an unknown part', async () => {
    const current = await call(`/finance/profit-split?month=${thisMonth}`, tokens.owner!);
    expect(current.body).toMatchObject({ status: 'in_progress', isEstimate: true, canComplete: false });
    expect(current.body.parts.length).toBeGreaterThan(0);
    expect((await call(`/finance/profit-split/${thisMonth}/parts/default-1`, tokens.owner!, 'PUT', {})).status).toBe(400);
    expect((await call(`/finance/profit-split/${FUTURE}/parts/default-1`, tokens.owner!, 'PUT', {})).status).toBe(400);
    expect((await call(`/finance/profit-split/${LOSS}/parts/default-1`, tokens.owner!, 'PUT', {})).status).toBe(400);
    expect((await call(`/finance/profit-split/${PROFIT}/parts/nope`, tokens.owner!, 'PUT', {})).status).toBe(404);
    expect((await call(`/finance/profit-split/${PROFIT}/parts/default-2`, tokens.owner!, 'PUT', { doneOn: '2099-01-01' })).status).toBe(400);
    expect((await call(`/finance/profit-split/${PROFIT}/parts/default-2`, tokens.owner!, 'PUT', { note: 'x'.repeat(201) })).status).toBe(400);
  });

  it('isolates companies', async () => {
    const other = await call(`/finance/profit-split?month=${PROFIT}`, tokens.other!);
    expect(other.status).toBe(200);
    expect(other.body).toMatchObject({ usingDefaults: true, netProfitCents: 0, parts: [] });
    expect((await call(`/finance/profit-split/${PROFIT}/parts/default-1`, tokens.other!, 'PUT', {})).status).toBe(400);
    expect(await db.orm.public.ProfitSplitPart.where({ companyId: otherCompanyId }).all()).toHaveLength(0);
    expect(await db.orm.public.ProfitSplitPart.where({ companyId }).all()).toHaveLength(3);
  });

  it('summarises Done ticks per account for a year', async () => {
    const summaryCompany = randomUUID();
    const summaryOwner = randomUUID();
    await db.orm.public.Company.create({ id: summaryCompany, name: v<120>('Summary fixture') });
    await db.orm.public.User.create({ id: summaryOwner, companyId: summaryCompany, role: 'administrator', locationId: null, fullName: v<120>('owner'), email: v<255>(`${summaryOwner}@test.invalid`), passwordHash: v<255>('unused') });
    const token = await app.get(JwtService).signAsync({ sub: summaryOwner, companyId: summaryCompany, role: 'administrator' });
    const empty = await call('/finance/profit-split/summary?year=2025', token);
    expect(empty).toMatchObject({ status: 200, body: { year: 2025, accounts: [], totalCents: 0, capitalCents: 0, profitCents: 0, grandTotalCents: 0, capital: { count: 0, amountCents: 0 } } });
    const tick = (month: string, partKey: string, partName: string, destination: string, amountCents: number) => db.orm.public.ProfitSplitCompletion.create({
      companyId: summaryCompany, month: `${month}-01`, partKey: v<40>(partKey), partName: v<80>(partName), destination: v<120>(destination), amountCents, percentBasisPoints: 1000, doneOn: `${month}-28`, note: v<200>(''), createdByUserId: summaryOwner,
    });
    await tick('2024-12', 'a', 'Tax', 'Zed account', 999);
    await tick('2025-01', 'a', 'Tax', 'Zed account', 100);
    await tick('2025-06', 'a', 'Tax reserve', 'Zed account', 250);
    await tick('2025-06', 'b', 'Growth', 'Alpha account', 40);
    await tick('2025-12', 'c', 'Old part', 'Gone account', 7);
    await tick('2025-06', 'capital', 'Stock capital', 'Capital account (restock)', 800);
    await tick('2025-07', 'capital', 'Stock capital', 'Capital account (restock)', 500);
    await tick('2026-02', 'capital', 'Stock capital', 'Capital account (restock)', 9);
    await tick('2026-01', 'a', 'Tax', 'Zed account', 555);
    await call('/finance/profit-split/settings', token, 'PUT', { parts: [{ key: 'a', name: 'Tax', destination: 'Zed account', percent: 50 }, { key: 'b', name: 'Growth', destination: 'Alpha account', percent: 50 }] });
    const result = await call('/finance/profit-split/summary?year=2025', token);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ year: 2025, totalCents: 397, profitCents: 397, capitalCents: 1300, grandTotalCents: 1697, capital: { destination: 'Capital account (restock)', partName: 'Stock capital', amountCents: 1300, count: 2 }, accounts: [
      { destination: 'Zed account', partNames: ['Tax', 'Tax reserve'], amountCents: 350, count: 2 },
      { destination: 'Alpha account', partNames: ['Growth'], amountCents: 40, count: 1 },
      { destination: 'Gone account', partNames: ['Old part'], amountCents: 7, count: 1 },
    ] });
    expect((await call('/finance/profit-split/summary?year=2026', token)).body).toMatchObject({ totalCents: 555, accounts: [{ destination: 'Zed account', count: 1 }] });
    // Another company's ticks and settings never leak in.
    expect((await call('/finance/profit-split/summary?year=2025', tokens.owner!)).body).toMatchObject({ year: 2025, accounts: [], totalCents: 0, capitalCents: 0, grandTotalCents: 0 });
  });

  it('shows stock capital from the Finance COGS line, even in a loss month, and nothing when no stock sold', async () => {
    const month = await call(`/finance/profit-split?month=${CAPITAL}`, tokens.owner!);
    expect(month.body.capital).toMatchObject({ amountCents: 800, status: 'complete', canComplete: true, completion: null, destination: 'Capital account (restock)' });
    const finance = await call('/finance?year=2025', tokens.owner!);
    const cogs = finance.body.months.find((row: any) => row.month === CAPITAL).lines.find((line: any) => line.key === 'cogs').actualCents;
    expect(month.body.capital.amountCents).toBe(cogs);
    const loss = await call(`/finance/profit-split?month=${CAPITAL_LOSS}`, tokens.owner!);
    expect(loss.body).toMatchObject({ hasProfit: false, parts: [], capital: { amountCents: 500, canComplete: true } });
    expect((await call(`/finance/profit-split?month=${ZERO}`, tokens.owner!)).body.capital).toMatchObject({ amountCents: 0, canComplete: false });
    expect((await call(`/finance/profit-split?month=${FUTURE}`, tokens.owner!)).body.capital).toMatchObject({ amountCents: 0, status: 'future', canComplete: false });
    const current = await call(`/finance/profit-split?month=${thisMonth}`, tokens.owner!);
    expect(current.body.capital).toMatchObject({ amountCents: 300, status: 'in_progress', isEstimate: true, canComplete: false });
  });

  it('ticks and un-ticks stock capital with a snapshot, in a loss month too', async () => {
    const done = await call(`/finance/profit-split/${CAPITAL_LOSS}/capital`, tokens.owner!, 'PUT', { doneOn: '2025-08-01', note: 'Moved to capital' });
    expect(done.status).toBe(200);
    expect(done.body.capital.completion).toMatchObject({ amountCents: 500, percentBasisPoints: 10000, doneOn: '2025-08-01', note: 'Moved to capital', changedSinceDone: false, partName: 'Stock capital', destination: 'Capital account (restock)' });
    expect(done.body.retired).toEqual([]);
    expect(await db.orm.public.ProfitSplitCompletion.first({ companyId, month: `${CAPITAL_LOSS}-01`, partKey: v<40>('capital') })).toMatchObject({ amountCents: 500, createdByUserId: ownerId });
    // A later sale changes COGS: the notice appears but the snapshot is kept.
    const item = (await db.orm.public.InventoryItem.first({ companyId }))!;
    const shop = (await db.orm.public.Location.first({ companyId }))!;
    await db.orm.public.StockMovement.create({ companyId, itemId: item.id, locationId: shop.id, type: 'sale', quantity: 1, unitPriceCents: 100, unitCostCents: 50, movementDate: `${CAPITAL_LOSS}-20` });
    const changed = await call(`/finance/profit-split?month=${CAPITAL_LOSS}`, tokens.owner!);
    expect(changed.body.capital).toMatchObject({ amountCents: 550, completion: { amountCents: 500, changedSinceDone: true } });
    expect((await db.orm.public.AuditEvent.where({ companyId }).all()).some(row => row.action === 'finance.stock_capital_done')).toBe(true);
    const undone = await call(`/finance/profit-split/${CAPITAL_LOSS}/capital`, tokens.owner!, 'DELETE');
    expect(undone.status).toBe(200);
    expect(undone.body.capital.completion).toBeNull();
    expect((await call(`/finance/profit-split/${CAPITAL_LOSS}/capital`, tokens.owner!, 'DELETE')).status).toBe(404);
    expect((await db.orm.public.AuditEvent.where({ companyId }).all()).some(row => row.action === 'finance.stock_capital_undone')).toBe(true);
  });

  it('rejects capital completion for in-progress, future and no-sales months and bad input; reserves the key', async () => {
    expect((await call(`/finance/profit-split/${thisMonth}/capital`, tokens.owner!, 'PUT', {})).status).toBe(400);
    expect((await call(`/finance/profit-split/${FUTURE}/capital`, tokens.owner!, 'PUT', {})).status).toBe(400);
    expect((await call(`/finance/profit-split/${ZERO}/capital`, tokens.owner!, 'PUT', {})).status).toBe(400);
    expect((await call(`/finance/profit-split/${CAPITAL}/capital`, tokens.owner!, 'PUT', { doneOn: '2099-01-01' })).status).toBe(400);
    expect((await call('/finance/profit-split/nope/capital', tokens.owner!, 'PUT', {})).status).toBe(400);
    expect((await call(`/finance/profit-split/${CAPITAL}/parts/capital`, tokens.owner!, 'PUT', {})).status).toBe(404);
    const reserved = await call('/finance/profit-split/settings', tokens.owner!, 'PUT', { parts: [{ key: 'capital', name: 'Other', destination: 'X', percent: 100 }] });
    expect(reserved.status).toBe(400);
    expect(await db.orm.public.ProfitSplitCompletion.where({ companyId, partKey: v<40>('capital') }).all()).toHaveLength(0);
  });

  it('keeps stock capital out of the retired list and isolates it per company', async () => {
    expect((await call(`/finance/profit-split/${CAPITAL}/capital`, tokens.owner!, 'PUT', {})).status).toBe(200);
    const view = await call(`/finance/profit-split?month=${CAPITAL}`, tokens.owner!);
    expect(view.body.retired.some((row: any) => row.key === 'capital')).toBe(false);
    expect(view.body.capital.completion).toMatchObject({ amountCents: 800 });
    const other = await call(`/finance/profit-split?month=${CAPITAL}`, tokens.other!);
    expect(other.body.capital).toMatchObject({ amountCents: 0, completion: null });
    expect((await call(`/finance/profit-split/${CAPITAL}/capital`, tokens.other!, 'PUT', {})).status).toBe(400);
    expect((await call(`/finance/profit-split/${CAPITAL}/capital`, tokens.other!, 'DELETE')).status).toBe(404);
    expect(await db.orm.public.ProfitSplitCompletion.where({ companyId: otherCompanyId }).all()).toHaveLength(0);
    expect((await call(`/finance/profit-split/${CAPITAL}/capital`, tokens.owner!, 'DELETE')).status).toBe(200);
  });

  it('rejects managers, attendants and bad years on the summary', async () => {
    for (const role of ['manager', 'attendant']) expect((await call('/finance/profit-split/summary?year=2025', tokens[role]!)).status).toBe(403);
    expect((await call('/finance/profit-split/summary?year=abc', tokens.owner!)).status).toBe(400);
    expect((await call('/finance/profit-split/summary', tokens.owner!)).status).toBe(400);
  });
});
