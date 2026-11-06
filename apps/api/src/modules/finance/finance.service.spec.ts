import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceService } from './finance.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { InventoryService } from '../inventory/inventory.service.js';

const companyId = '31000000-0000-4000-8000-000000000001';
const userId = '41000000-0000-4000-8000-000000000001';
const categories = [{ id: 'category', companyId, name: 'Rent', isActive: true }, { id: 'archived', companyId, name: 'Old', isActive: false }];
const actor = vi.fn();
const categoryFirst = vi.fn();
const categoryCreate = vi.fn();
const categoryWhere = vi.fn(() => ({ all: async () => categories }));
const entryFirst = vi.fn();
const entryCreate = vi.fn(async (row: object) => ({ id: 'new', ...row }));
const entryUpdate = vi.fn(async (row: object) => ({ id: 'entry', ...row }));
const audit = vi.fn();
const query = vi.fn();
const source = vi.fn(async () => ({ items: [], locations: [], movements: [{ id: 'm', itemId: 'i', locationId: 'l', destinationLocationId: null, quantity: 1, type: 'return_in', unitPriceCents: 500, unitCostCents: 100, supplierId: null, relatedMovementId: null, stockCountId: null, movementDate: '2026-01-05', reference: null, note: null, createdAt: '' }], discounts: [] }));
const scoped = () => { const chain = { where: vi.fn(() => chain), all: async () => [] }; return chain; };
const entryWhere = vi.fn((_filter: unknown) => ({ ...scoped(), update: entryUpdate, delete: vi.fn() }));
const budgetWhere = vi.fn((_filter: unknown) => scoped());
const tx = { query, orm: { public: {
  User: { first: actor }, Company: { first: async () => ({ name: 'Shop A', currency: 'GHS', timeZone: 'Africa/Accra' }) },
  FinanceCategory: { first: categoryFirst, where: categoryWhere, create: categoryCreate },
  FinanceEntry: { first: entryFirst, where: entryWhere, create: entryCreate },
  FinanceBudget: { where: budgetWhere, upsert: vi.fn() },
  AuditEvent: { create: audit },
} } };
const prisma = { withCompany: vi.fn(async (_id: string, work: (client: typeof tx) => unknown) => work(tx)), client: { raw: { sql: () => ({ returnsRow: () => ({ build: () => ({}) }) }) } } };
const service = new FinanceService(prisma as unknown as PrismaService, { profitabilitySource: source } as unknown as InventoryService);

beforeEach(() => {
  vi.clearAllMocks();
  actor.mockResolvedValue({ id: userId, companyId, role: 'administrator', isActive: true });
  categoryFirst.mockResolvedValue(categories[0]);
  entryFirst.mockResolvedValue(null);
});
describe('finance authorization and tenant scoping', () => {
  it.each(['inventory_manager', 'shop_attendant'])('denies %s report and mutation access before reading finance data', async role => {
    actor.mockResolvedValue({ id: userId, companyId, role, isActive: true });
    await expect(service.report(userId, companyId, { year: 2026 })).rejects.toThrow('Only an administrator');
    await expect(service.export(userId, companyId, { year: 2026 })).rejects.toThrow('Only an administrator');
    await expect(service.entries(userId, companyId, {})).rejects.toThrow('Only an administrator');
    await expect(service.saveBudget(userId, companyId, { month: '2026-01-01', lines: [] })).rejects.toThrow('Only an administrator');
    await expect(service.saveEntry(userId, companyId, { kind: 'other_revenue', entryDate: '2026-01-01', amountCents: 1, note: '' })).rejects.toThrow('Only an administrator');
    await expect(service.deleteEntry(userId, companyId, 'entry')).rejects.toThrow('Only an administrator');
    await expect(service.saveCategory(userId, companyId, { name: 'Rent' })).rejects.toThrow('Only an administrator');
    expect(categoryWhere).not.toHaveBeenCalled();
    expect(source).not.toHaveBeenCalled();
  });
  it('scopes every report read to the authenticated company', async () => {
    await service.report(userId, companyId, { year: 2026 });
    expect(prisma.withCompany).toHaveBeenCalledWith(companyId, expect.any(Function), { consistentSnapshot: true });
    expect(actor).toHaveBeenCalledWith({ id: userId, companyId });
    expect(categoryWhere).toHaveBeenCalledWith({ companyId });
    expect(entryWhere).toHaveBeenCalledWith({ companyId });
    expect(budgetWhere).toHaveBeenCalledWith({ companyId });
    expect(source).toHaveBeenCalledWith(tx, companyId);
  });
  it('takes no lock and writes nothing on a report read once categories exist', async () => {
    await service.report(userId, companyId, { year: 2026 });
    expect(query).not.toHaveBeenCalled();
    expect(categoryCreate).not.toHaveBeenCalled();
  });
  it('creates the default categories once, in their own transaction, for a new company', async () => {
    categoryFirst.mockResolvedValue(null);
    await service.report(userId, companyId, { year: 2026 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(categoryCreate).toHaveBeenCalledTimes(10);
    expect(prisma.withCompany).toHaveBeenNthCalledWith(1, companyId, expect.any(Function));
  });
  it('rejects expense categories belonging to another tenant', async () => {
    await expect(service.saveEntry(userId, companyId, { kind: 'expense', categoryId: 'foreign', entryDate: '2026-01-01', amountCents: 100, note: '' })).rejects.toThrow('active expense category');
    await expect(service.saveBudget(userId, companyId, { month: '2026-01-01', lines: [{ lineKey: 'expense:foreign', amountCents: 100 }] })).rejects.toThrow('this company');
    expect(audit).not.toHaveBeenCalled();
  });
  it('cannot delete or edit another tenant entry by id', async () => {
    await expect(service.deleteEntry(userId, companyId, 'foreign-entry')).rejects.toThrow('Entry not found');
    expect(entryFirst).toHaveBeenCalledWith({ companyId, id: 'foreign-entry' });
    await expect(service.saveEntry(userId, companyId, { kind: 'other_revenue', entryDate: '2026-01-01', amountCents: 1, note: '' }, 'foreign-entry')).rejects.toThrow('Entry not found');
  });
  it('denies deactivated owners', async () => {
    actor.mockResolvedValue({ role: 'administrator', isActive: false });
    await expect(service.report(userId, companyId, { year: 2026 })).rejects.toThrow('Account no longer exists');
  });
});
describe('finance entries and exports', () => {
  it('keeps an entry editable after its category is archived, but blocks new use of that category', async () => {
    const body = { kind: 'expense' as const, categoryId: 'archived', entryDate: '2026-01-01', amountCents: 100, note: 'Fix' };
    await expect(service.saveEntry(userId, companyId, body)).rejects.toThrow('active expense category');
    entryFirst.mockResolvedValue({ id: 'entry', companyId, categoryId: 'archived' });
    await expect(service.saveEntry(userId, companyId, body, 'entry')).resolves.toMatchObject({ categoryId: 'archived' });
  });
  it('rejects impossible and out-of-range entry dates', async () => {
    await expect(service.saveEntry(userId, companyId, { kind: 'other_revenue', entryDate: '2026-02-30', amountCents: 1, note: '' })).rejects.toThrow('valid calendar dates');
    await expect(service.saveEntry(userId, companyId, { kind: 'other_revenue', entryDate: '1990-01-01', amountCents: 1, note: '' })).rejects.toThrow('between 2000 and 2100');
  });
  it('rejects an entry list whose end is before its start', async () => {
    await expect(service.entries(userId, companyId, { from: '2026-02-01', to: '2026-01-01' })).rejects.toThrow('on or after start');
  });
  it('exports company, currency, period and spreadsheet-numeric negatives, with a dash for zero budgets', async () => {
    const file = await service.export(userId, companyId, { year: 2026, view: 'month', month: '2026-01' });
    expect(file.filename).toBe('stockledger-finance-2026-01-month.csv');
    expect(file.content).toContain('Shop A,GHS,2026-01,2026-01-01,2026-01-31,Revenue,Sales Returns / Allowances,0.00,-5.00,-5.00,—');
    expect(file.content).not.toContain("'-");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.exported', companyId }));
  });
  it('adds the year total after the twelve months and rejects a month outside the year', async () => {
    const file = await service.export(userId, companyId, { year: 2026, view: 'months' });
    expect(file.filename).toBe('stockledger-finance-2026-months.csv');
    expect(file.content).toContain('Shop A,GHS,2026-12,');
    expect(file.content).toContain('Shop A,GHS,2026,2026-01-01,2026-12-31,');
    await expect(service.export(userId, companyId, { year: 2026, view: 'month', month: '2025-01' })).rejects.toThrow('selected year');
  });
});
