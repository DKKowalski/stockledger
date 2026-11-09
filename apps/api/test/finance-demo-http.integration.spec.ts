import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import postgres from '@prisma/orm-postgres/runtime';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Contract } from '../src/prisma/contract.d.js';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

const url = process.env.INVENTORY_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) {
  throw new Error('HTTP integration tests require the isolated test database runner');
}
const db = postgres<Contract>({ contractJson, url });
const demoCompanyId = randomUUID();
const otherCompanyId = randomUUID();
const demoOwnerId = randomUUID();
const otherOwnerId = randomUUID();
const categoryId = randomUUID();
const entryId = randomUUID();
const varchar = <N extends number>(value: string) => value as Varchar<N>;
let app: INestApplication;
let base: string;
let demoToken: string;
let otherToken: string;

async function request(path: string, token: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() as { message?: string } };
}
const counts = async () => [
  (await db.orm.public.FinanceCategory.where({ companyId: demoCompanyId }).all()).length,
  (await db.orm.public.FinanceEntry.where({ companyId: demoCompanyId }).all()).length,
  (await db.orm.public.FinanceBudget.where({ companyId: demoCompanyId }).all()).length,
];

beforeAll(async () => {
  vi.stubEnv('DEMO_COMPANY_ID', demoCompanyId);
  for (const [companyId, userId, name] of [[demoCompanyId, demoOwnerId, 'Demo fixture'], [otherCompanyId, otherOwnerId, 'Paying fixture']] as const) {
    await db.orm.public.Company.create({ id: companyId, name: varchar<120>(name) });
    await db.orm.public.User.create({ id: userId, companyId, role: 'administrator', locationId: null, fullName: varchar<120>('Owner'), email: varchar<255>(`${userId}@test.invalid`), passwordHash: varchar<255>('unused') });
  }
  await db.orm.public.FinanceCategory.create({ id: categoryId, companyId: demoCompanyId, name: varchar<80>('Rent') });
  await db.orm.public.FinanceEntry.create({ id: entryId, companyId: demoCompanyId, createdByUserId: demoOwnerId, kind: varchar<20>('expense'), categoryId, entryDate: '2026-01-01', amountCents: 100, note: varchar<500>('Seeded') });
  // Use compiled metadata so the global interceptor is wired exactly as it is in the deployed API.
  const compiledModule = '../dist/app.module.js';
  const { AppModule } = await import(compiledModule);
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const jwt = app.get(JwtService);
  demoToken = await jwt.signAsync({ sub: demoOwnerId, companyId: demoCompanyId, role: 'administrator' });
  otherToken = await jwt.signAsync({ sub: otherOwnerId, companyId: otherCompanyId, role: 'administrator' });
});

afterAll(async () => {
  if (app) await app.close();
  await db.close();
  vi.unstubAllEnvs();
});

describe('read-only demo finance', () => {
  const writes = [
    ['POST', '/finance/categories', { name: 'New' }],
    ['PATCH', `/finance/categories/${categoryId}`, { name: 'Renamed', isActive: false }],
    ['POST', '/finance/entries', { kind: 'other_revenue', entryDate: '2026-01-02', amountCents: 100 }],
    ['PATCH', `/finance/entries/${entryId}`, { kind: 'other_revenue', entryDate: '2026-01-02', amountCents: 100 }],
    ['DELETE', `/finance/entries/${entryId}`, undefined],
    ['POST', '/finance/budgets', { month: '2026-01-01', lines: [{ lineKey: 'sales', amountCents: 100 }] }],
    ['PUT', '/finance/profit-split/settings', { parts: [{ name: 'All', destination: 'Somewhere', percent: 100 }] }],
    ['PUT', '/finance/profit-split/2026-01/parts/default-1', {}],
    ['DELETE', '/finance/profit-split/2026-01/parts/default-1', undefined],
  ] as const;

  it.each(writes)('rejects %s %s with 403 and changes nothing', async (method, path, body) => {
    const before = await counts();
    const result = await request(path, demoToken, method, body);
    expect(result.status).toBe(403);
    expect(result.body.message).toContain('read-only');
    expect(await counts()).toEqual(before);
    expect(await db.orm.public.FinanceEntry.first({ id: entryId })).toMatchObject({ amountCents: 100, kind: 'expense' });
    expect(await db.orm.public.FinanceCategory.first({ id: categoryId })).toMatchObject({ name: 'Rent', isActive: true });
  });

  it('still lets the demo read, and leaves other companies able to write', async () => {
    expect((await request('/finance?year=2026', demoToken)).status).toBe(200);
    expect((await request('/finance/entries', demoToken)).status).toBe(200);
    expect((await request('/finance/entries', otherToken, 'POST', { kind: 'other_revenue', entryDate: '2026-01-02', amountCents: 100 })).status).toBe(201);
  });
});
