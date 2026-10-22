import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import postgres from '@prisma/orm-postgres/runtime';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import pg from 'pg';
import * as argon2 from 'argon2';
import { PrismaService, type PrismaTransaction } from '../src/prisma/prisma.service.js';
import { DataExportService } from '../src/modules/settings/data-export.service.js';
import { DataExportType } from '../src/modules/settings/data-export.types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Contract } from '../src/prisma/contract.d.js';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

const url = process.env.INVENTORY_TEST_DATABASE_URL!;
if (!url || new URL(url).hostname !== '127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) throw new Error('Use isolated integration runner');
const db = postgres<Contract>({ contractJson, url });
const sql = new pg.Client({ connectionString: url });
const runtimeRole = `stockledger_test_${randomUUID().replaceAll('-', '')}`;
const varchar = <N extends number>(value: string) => value as Varchar<N>;
let app: INestApplication, base: string, config: ConfigService, jwt: JwtService;
const date = new Date().toISOString().slice(0, 10);

async function request(path: string, token?: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  await sql.connect();
  await sql.query(`CREATE ROLE "${runtimeRole}" LOGIN PASSWORD 'isolated-runtime-only' IN ROLE stockledger_app`);
  const runtimeUrl = new URL(url); runtimeUrl.username = runtimeRole; runtimeUrl.password = 'isolated-runtime-only';
  const runtime = postgres<Contract>({ contractJson, url: runtimeUrl.toString() });
  const compiled = '../dist/app.module.js', prismaModule = '../dist/prisma/prisma.service.js';
  const { AppModule } = await import(compiled);
  const { PrismaService } = await import(prismaModule);
  app = await NestFactory.create(AppModule, { logger: false });
  Object.assign(app.get(PrismaService), { client: runtime });
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  config = app.get(ConfigService); jwt = app.get(JwtService);
});
afterAll(async () => { if (app) await app.close(); await db.close(); await sql.query(`DROP ROLE IF EXISTS "${runtimeRole}"`); await sql.end(); vi.restoreAllMocks(); });

async function fixture(stock = 40) {
  config.set('app.environment', 'test');
  const company = await db.orm.public.Company.create({ name: varchar<120>('Phase 3 synthetic business') });
  const shop = await db.orm.public.Location.create({ companyId: company.id, name: varchar<120>('Shop'), type: 'shop' });
  const otherShop = await db.orm.public.Location.create({ companyId: company.id, name: varchar<120>('Other shop'), type: 'shop' });
  const users = {} as Record<'admin' | 'attendant' | 'other' | 'manager', { id: string; token: string }>;
  for (const [key,role,locationId] of [['admin','administrator',null],['attendant','shop_attendant',shop.id],['other','shop_attendant',otherShop.id],['manager','inventory_manager',null]] as const) {
    const user = await db.orm.public.User.create({ companyId:company.id,locationId,role,fullName:varchar<120>(key),email:varchar<255>(`${randomUUID()}@test.invalid`),passwordHash:varchar<255>('unused') });
    users[key] = { id:user.id, token:await jwt.signAsync({sub:user.id,companyId:company.id,role}) };
  }
  config.set('app.pricingPreviewCompanyIds', [company.id]); config.set('app.saleCompletionCompanyIds', [company.id]);
  const items = [];
  for (const [index,opening] of [stock,stock].entries()) {
    const item = await db.orm.public.InventoryItem.create({companyId:company.id,sku:varchar<40>(`ITEM-${index}`),name:varchar<120>(`Test item ${index}`),category:varchar<80>('Test'),unit:varchar<20>('pcs'),unitCostCents:1000,sellingPriceCents:1500});
    await db.orm.public.LocationStock.create({ companyId:company.id,locationId:shop.id,itemId:item.id,openingStock:opening });
    const saved = await request(`/inventory/items/${item.id}/pricing-preview`,users.admin.token,'PATCH',{expectedVersion:0,previewEnabled:true,baseUnit:'pcs',baseUnitVerified:true,package:{label:'box',size:10,priceCents:12000},bulkTiers:[{minimumQuantity:5,unitPriceCents:1300}]});
    expect(saved.status).toBe(200); items.push(item);
  }
  return { company, shop, otherShop, ...users, items };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function input(f: Fixture, quantity = 15, index = 0) { return { movementDate:date, lines:[{itemId:f.items[index]!.id,quantity,expectedVersion:1,expectedRetailPriceCents:1500}] }; }
async function quoted(f: Fixture, quantity = 15) { const response = await request('/inventory/sales/quote',f.attendant.token,'POST',input(f,quantity)); expect(response.status).toBe(201); return response.body; }
async function complete(f: Fixture, quote: {quoteToken:string}, key: string = randomUUID()) { return request('/inventory/sales/complete',f.attendant.token,'POST',{idempotencyKey:key,quoteToken:quote.quoteToken}); }
async function closing(f: Fixture) { const snap=await request('/inventory/snapshot',f.attendant.token); return snap.body.positions.find((p:{item:{id:string}})=>p.item.id===f.items[0]!.id).closing; }
async function counts(f: Fixture) { return {sales:(await db.orm.public.Sale.where({companyId:f.company.id}).all()).length,movements:(await db.orm.public.StockMovement.where({companyId:f.company.id}).all()).length}; }

describe('durable development sale completion via real HTTP and restricted runtime role',()=>{
  it('defaults off, requires authentication/enrollment, and refuses activation in production',async()=>{
    const f=await fixture();
    expect((await request('/inventory/sale-completion')).status).toBe(401);
    config.set('app.saleCompletionCompanyIds',[]);
    expect((await request('/inventory/sale-completion',f.attendant.token)).body.available).toBe(false);
    expect((await request('/inventory/sales/quote',f.attendant.token,'POST',input(f))).status).toBe(403);
    config.set('app.saleCompletionCompanyIds',[f.company.id]);
    const developmentQuote = await quoted(f);
    config.set('app.environment','production');
    expect((await complete(f,developmentQuote)).status).toBe(403);
    expect((await request('/inventory/sales/quote',f.attendant.token,'POST',input(f))).status).toBe(403);
    expect(await counts(f)).toEqual({sales:0,movements:0});
  });

  it('lets an owner switch on deals in production and sells items without deals at their single price',async()=>{
    const f=await fixture();
    config.set('app.saleCompletionCompanyIds',[]); config.set('app.pricingPreviewCompanyIds',[]); config.set('app.environment','production');
    try {
      expect((await request('/inventory/sale-completion',f.attendant.token)).body.available).toBe(false);
      const settings={defaultLocationId:null,defaultUnit:'pcs',defaultReorderLevel:10,skuPrefix:'SKU',nextSkuNumber:1,allowNegativeStock:false,requirePurchaseSource:false,requireAdjustmentReason:true};
      expect((await request('/settings/inventory',f.attendant.token,'PATCH',{...settings,hybridPricingEnabled:true})).status).toBe(403);
      expect((await request('/settings/inventory',f.admin.token,'PATCH',{...settings,hybridPricingEnabled:true})).body.hybridPricingEnabled).toBe(true);
      expect((await request('/inventory/sale-completion',f.attendant.token)).body.available).toBe(true);
      const plain=await db.orm.public.InventoryItem.create({companyId:f.company.id,sku:varchar<40>('PLAIN'),name:varchar<120>('No deals'),category:varchar<80>('Test'),unit:varchar<20>('pcs'),unitCostCents:1000,sellingPriceCents:1500});
      await db.orm.public.LocationStock.create({companyId:f.company.id,locationId:f.shop.id,itemId:plain.id,openingStock:10});
      const single=await request('/inventory/sales/quote',f.attendant.token,'POST',{movementDate:date,lines:[{itemId:plain.id,quantity:3,expectedVersion:0,expectedRetailPriceCents:1500}]});
      expect(single.status).toBe(201); expect(single.body).toMatchObject({totalCents:4500,automaticDiscountCents:0});
      expect((await complete(f,single.body)).status).toBe(201);
      expect((await quoted(f)).totalCents).toBe(18500);
      expect((await request('/settings/inventory',f.admin.token,'PATCH',{...settings,hybridPricingEnabled:false})).body.hybridPricingEnabled).toBe(false);
      expect((await request('/inventory/sales/quote',f.attendant.token,'POST',input(f))).status).toBe(403);
    } finally { config.set('app.environment','test'); }
  });

  it('persists exact grouped totals once and preserves stock/profit/legacy export arithmetic',async()=>{
    const f=await fixture(); const quote=await quoted(f); expect(quote.totalCents).toBe(18500);
    expect(JSON.stringify(quote)).not.toContain('unitCostCents');expect(JSON.stringify(quote)).not.toContain('cogsCents');
    expect(await counts(f)).toEqual({sales:0,movements:0});
    const response=await complete(f,quote);expect(response.status).toBe(201);expect(response.body).toMatchObject({status:'completed',totalCents:18500,grossSalesCents:22500,automaticDiscountCents:4000});
    expect(response.body.lines[0].components).toMatchObject([{category:'box',quantity:10,unitPriceCents:1200,totalCents:12000},{category:'bulk',quantity:5,unitPriceCents:1300,totalCents:6500}]);
    expect(JSON.stringify(response.body)).not.toContain('cogsCents');expect(await closing(f)).toBe(25);
    const profit=await request(`/inventory/profitability?itemId=${f.items[0]!.id}`,f.admin.token);expect(profit.body.summary).toMatchObject({netSalesCents:18500,cogsCents:15000,grossProfitCents:3500,unitsSold:15});
    const snap=await request('/inventory/snapshot',f.admin.token);expect(snap.body.movements.every((m:{saleId:string})=>m.saleId===response.body.id)).toBe(true);
    const detail=await request(`/inventory/sales/${response.body.id}`,f.admin.token);expect(detail.body.cogsCents).toBe(15000);
    for(const version of ['workspace','workspace-v2','workspace-v3']) {
      const exported=await request(`/settings/exports/${version}`,f.admin.token);expect(exported.status).toBe(200);
      if(version==='workspace-v3'){expect(exported.body.sales).toHaveLength(1);expect(exported.body.saleComponents).toHaveLength(2);}else{expect(exported.body.sales).toBeUndefined();}
    }
  });

  it('serializes same-key retries and keeps original results recoverable after expiry and disabled writes',async()=>{
    const f=await fixture();const quote=await quoted(f);const key=randomUUID();
    const results=await Promise.all([complete(f,quote,key),complete(f,quote,key.toUpperCase())]);expect(results.map(r=>r.status)).toEqual([201,201]);expect(results[0]!.body).toEqual(results[1]!.body);expect(await counts(f)).toEqual({sales:1,movements:2});
    const realNow=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(realNow+11*60_000);
    try{ config.set('app.saleCompletionCompanyIds',[]); expect((await complete(f,quote,key)).body.id).toBe(results[0]!.body.id);
      const lookup=await request(`/inventory/sales/requests/${key}`,f.attendant.token);expect(lookup.body.sale.id).toBe(results[0]!.body.id);
    }finally{clock.mockRestore();}
    expect(await closing(f)).toBe(25);
  });

  it('rejects changed payloads on a used key, forged tokens and client-supplied totals',async()=>{
    const f=await fixture();const quote=await quoted(f);const key=randomUUID();expect((await complete(f,quote,key)).status).toBe(201);
    const otherQuote=await quoted(f,2);expect((await complete(f,otherQuote,key)).status).toBe(409);
    expect((await complete(f,{quoteToken:`${quote.quoteToken.split('.')[0]}.invalid-signature`})).status).toBe(409);
    expect((await request('/inventory/sales/complete',f.attendant.token,'POST',{idempotencyKey:randomUUID(),quoteToken:quote.quoteToken,totalCents:1})).status).toBe(400);
    expect((await request('/inventory/sales/quote',f.attendant.token,'POST',{...input(f),lines:[{...input(f).lines[0],quantity:1.5}]})).status).toBe(400);
    expect(await counts(f)).toEqual({sales:1,movements:2});
  });

  it.each(['price','rules','cost','currency','negative stock','unit'] as const)('rejects stale %s with zero writes',async(change)=>{
    const f=await fixture();const quote=await quoted(f);
    if(change==='price')await db.orm.public.InventoryItem.where({id:f.items[0]!.id}).update({sellingPriceCents:1600});
    if(change==='cost')await db.orm.public.InventoryItem.where({id:f.items[0]!.id}).update({unitCostCents:1100});
    if(change==='unit')await db.orm.public.InventoryItem.where({id:f.items[0]!.id}).update({unit:varchar<20>('carton')});
    if(change==='currency')await db.orm.public.Company.where({id:f.company.id}).update({currency:varchar<3>('USD')});
    if(change==='negative stock')await db.orm.public.Company.where({id:f.company.id}).update({allowNegativeStock:true});
    if(change==='rules')await request(`/inventory/items/${f.items[0]!.id}/pricing-preview`,f.admin.token,'PATCH',{expectedVersion:1,previewEnabled:false,baseUnit:'pcs',baseUnitVerified:true,package:null,bulkTiers:[]});
    expect((await complete(f,quote)).status).toBe(409);expect(await counts(f)).toEqual({sales:0,movements:0});
  });

  it('rejects an expired unused quote and actor/shop/tenant/role substitution',async()=>{
    const f=await fixture();const quote=await quoted(f);
    const foreign=await fixture();config.set('app.pricingPreviewCompanyIds',[f.company.id,foreign.company.id]);config.set('app.saleCompletionCompanyIds',[f.company.id,foreign.company.id]);
    const body={idempotencyKey:randomUUID(),quoteToken:quote.quoteToken};
    expect((await request('/inventory/sales/complete',f.other.token,'POST',body)).status).toBe(403);
    expect((await request('/inventory/sales/complete',foreign.attendant.token,'POST',body)).status).toBe(403);
    expect((await request('/inventory/sales/quote',f.admin.token,'POST',input(f))).status).toBe(403);
    expect((await request('/inventory/sales/quote',f.manager.token,'POST',input(f))).status).toBe(403);
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+11*60_000);try{expect((await complete(f,quote)).status).toBe(409);}finally{clock.mockRestore();}
    expect(await counts(f)).toEqual({sales:0,movements:0});
  });

  it('commits only one winner when two new requests compete for the last units',async()=>{
    const f=await fixture(15);const quote=await quoted(f);
    const results=await Promise.all([complete(f,quote),complete(f,quote)]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);expect(await closing(f)).toBe(0);expect(await counts(f)).toEqual({sales:1,movements:2});
  });

  it('uses the same item lock as the legacy retail endpoint under concurrent sales',async()=>{
    const f=await fixture(15);const quote=await quoted(f);
    const results=await Promise.all([complete(f,quote),request('/inventory/movements',f.attendant.token,'POST',{itemId:f.items[0]!.id,locationId:f.shop.id,type:'sale',quantity:15,expectedUnitPriceCents:1500,movementDate:date})]);
    expect(results.map(r=>r.status).sort()).toEqual([201,409]);expect(await closing(f)).toBe(0);
    expect((await db.orm.public.StockMovement.where({companyId:f.company.id}).all()).reduce((sum,m)=>sum+m.quantity,0)).toBe(15);
  });

  it('aggregates duplicate inputs and rolls back a whole basket when one product has insufficient stock',async()=>{
    const f=await fixture(15);const body={movementDate:date,lines:[{...input(f,7).lines[0]!},{...input(f,8).lines[0]!},{...input(f,16,1).lines[0]!}]};
    const quote=await request('/inventory/sales/quote',f.attendant.token,'POST',body);expect(quote.status).toBe(201);expect(quote.body.lines).toHaveLength(2);
    expect((await complete(f,quote.body)).status).toBe(409);expect(await counts(f)).toEqual({sales:0,movements:0});expect(await closing(f)).toBe(15);
  });

  it('keeps multi-product completions atomic and locks opposite input orders without deadlock',async()=>{
    const f=await fixture(30);const body={movementDate:date,lines:[...input(f,15).lines,...input(f,15,1).lines]};
    const one=await request('/inventory/sales/quote',f.attendant.token,'POST',body);const two=await request('/inventory/sales/quote',f.attendant.token,'POST',{...body,lines:[...body.lines].reverse()});
    const results=await Promise.all([complete(f,one.body),complete(f,two.body)]);expect(results.map(r=>r.status)).toEqual([201,201]);expect(await closing(f)).toBe(0);expect(await counts(f)).toEqual({sales:2,movements:8});
  });

  it('rolls back header, lines, movements and audit if a later component insert fails',async()=>{
    const f=await fixture();const quote=await quoted(f);const key=randomUUID();
    await sql.query(`CREATE FUNCTION public.phase3_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id = '${f.company.id}'::uuid AND NEW.position = 1 THEN RAISE EXCEPTION 'Injected component failure'; END IF; RETURN NEW; END $$`);
    await sql.query('CREATE TRIGGER phase3_fail BEFORE INSERT ON sale_components FOR EACH ROW EXECUTE FUNCTION public.phase3_injected_failure()');
    try{expect((await complete(f,quote,key)).status).toBe(500);}finally{await sql.query('DROP TRIGGER phase3_fail ON sale_components');await sql.query('DROP FUNCTION public.phase3_injected_failure()');}
    expect(await counts(f)).toEqual({sales:0,movements:0});expect(await db.orm.public.SaleLine.where({companyId:f.company.id}).all()).toHaveLength(0);
    expect(await db.orm.public.AuditEvent.where({companyId:f.company.id,action:varchar<80>('inventory.sale_completed')}).all()).toHaveLength(0);
    expect((await complete(f,quote,key)).status).toBe(201);expect(await closing(f)).toBe(25);
  });

  it('preserves indivisible package cents exactly and rejects transaction amount overflow',async()=>{
    const f=await fixture(30);
    await request(`/inventory/items/${f.items[0]!.id}/pricing-preview`,f.admin.token,'PATCH',{expectedVersion:1,previewEnabled:true,baseUnit:'pcs',baseUnitVerified:true,package:{label:'box',size:24,priceCents:10000},bulkTiers:[]});
    const quote=await request('/inventory/sales/quote',f.attendant.token,'POST',{...input(f,24),lines:[{...input(f,24).lines[0],expectedVersion:2}]});
    const result=await complete(f,quote.body);expect(result.status).toBe(201);expect(result.body.totalCents).toBe(10000);expect(result.body.lines[0].components.map((c:{quantity:number;unitPriceCents:number})=>[c.quantity,c.unitPriceCents])).toEqual([[16,417],[8,416]]);expect(await closing(f)).toBe(6);
    expect((await request('/inventory/sales/quote',f.attendant.token,'POST',{...input(f,2147483647),lines:[{...input(f,2147483647).lines[0],expectedVersion:2}]})).status).toBe(400);
  });

  it('protects grouped movements from legacy deletion/returns and enforces tenant-scoped immutable records',async()=>{
    const f=await fixture();const quote=await quoted(f);const saved=await complete(f,quote);const movement=saved.body.lines[0].components[0].movementId;
    expect((await request(`/inventory/movements/${movement}`,f.admin.token,'DELETE')).status).toBe(409);
    expect((await request('/inventory/movements',f.admin.token,'POST',{itemId:f.items[0]!.id,locationId:f.shop.id,type:'return_in',quantity:1,relatedMovementId:movement,movementDate:date})).status).toBe(409);
    expect((await request(`/inventory/sales/${saved.body.id}`,f.other.token)).status).toBe(404);
    await db.transaction(async tx=>{
      await tx.execute(db.raw.sql`SET LOCAL ROLE stockledger_app`.affectedCount().build());
      expect(await tx.orm.public.Sale.where({companyId:f.company.id}).all()).toHaveLength(0);
    });
    await expect(db.transaction(async tx=>{await tx.execute(db.raw.sql`SET LOCAL ROLE stockledger_app`.affectedCount().build());await tx.query(db.raw.sql`SELECT set_config('app.current_company_id', ${f.company.id}, true) AS id`.returnsRow({id:'pg/text@1'}).build());await tx.orm.public.Sale.where({id:saved.body.id}).update({totalCents:1});})).rejects.toThrow();
    await db.transaction(async tx=>{await tx.execute(db.raw.sql`SET LOCAL ROLE stockledger_app`.affectedCount().build());await tx.query(db.raw.sql`SELECT set_config('app.current_company_id', ${f.company.id}, true) AS id`.returnsRow({id:'pg/text@1'}).build());await tx.orm.public.SaleComponent.where({companyId:f.company.id}).delete();});
    expect(await counts(f)).toEqual({sales:1,movements:2});expect(await db.orm.public.SaleComponent.where({companyId:f.company.id}).all()).toHaveLength(2);
  });
  it('canonicalizes uppercase UUIDs before stale checks, aggregation and completion', async () => {
    const f = await fixture();
    const uppercase = f.items[0]!.id.toUpperCase();
    expect((await request('/inventory/sales/quote', f.attendant.token, 'POST', { ...input(f), lines: [{ ...input(f).lines[0], itemId: uppercase, expectedRetailPriceCents: 1 }] })).status).toBe(409);
    const mixed = { movementDate: date, lines: [{ ...input(f, 7).lines[0]! }, { ...input(f, 8).lines[0]!, itemId: uppercase }] };
    const preview = await request('/inventory/pricing-preview/quote', f.attendant.token, 'POST', { lines: mixed.lines.map(({ expectedRetailPriceCents: _price, ...line }) => line) });
    expect(preview.body.lines).toHaveLength(1); expect(preview.body.totalCents).toBe(18500);
    const quote = await request('/inventory/sales/quote', f.attendant.token, 'POST', mixed);
    expect(quote.status).toBe(201); expect(quote.body.lines).toHaveLength(1);
    expect((await complete(f, quote.body)).status).toBe(201); expect(await closing(f)).toBe(25);
  });

  it('keeps completed item/price/cost snapshots after catalog changes', async () => {
    const f = await fixture(); const saved = await complete(f, await quoted(f));
    await db.orm.public.InventoryItem.where({ id: f.items[0]!.id }).update({ name: varchar<120>('Changed name'), unitCostCents: 2000, sellingPriceCents: 3000 });
    const original = await request(`/inventory/sales/${saved.body.id}`, f.admin.token);
    expect(original.body).toMatchObject({ totalCents: 18500, cogsCents: 15000 });
    expect(original.body.lines[0]).toMatchObject({ itemName: 'Test item 0', retailPriceCents: 1500, unitCostCents: 1000 });
  });

  it('exports archive v3 from one snapshot while a sale commits between table reads', async () => {
    const f = await fixture(); const quote = await quoted(f);
    const real = Object.assign(new PrismaService(), { client: db });
    let markRead!: () => void, release!: () => void;
    const read = new Promise<void>(resolve => { markRead = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const observed = {
      client: db,
      withCompany: <T>(companyId: string, work: (tx: PrismaTransaction) => Promise<T>, options?: { consistentSnapshot?: boolean }) => real.withCompany(companyId, async tx => {
        const movementModel = tx.orm.public.StockMovement;
        const movement = new Proxy(movementModel, { get(target, key) {
          if (key !== 'where') return Reflect.get(target, key, target);
          return (...args: Parameters<typeof movementModel.where>) => {
            const builder = target.where(...args);
            return new Proxy(builder, { get(query, member) {
              if (member === 'all') return async () => { const rows = await query.all(); markRead(); await released; return rows; };
              const value = Reflect.get(query, member, query); return typeof value === 'function' ? value.bind(query) : value;
            } });
          };
        } });
        const models = new Proxy(tx.orm.public, { get(target, key) { return key === 'StockMovement' ? movement : Reflect.get(target, key, target); } });
        return work({ ...tx, orm: { ...tx.orm, public: models } } as PrismaTransaction);
      }, options),
    } as PrismaService;
    const exporting = new DataExportService(observed).create(f.admin.id, f.company.id, DataExportType.WORKSPACE_V3);
    await Promise.race([read, exporting.then(() => { throw new Error('Expected an observed ledger read'); })]);
    try { expect((await complete(f, quote)).status).toBe(201); } finally { release(); }
    const archived = JSON.parse((await exporting).content);
    expect(archived.sales).toHaveLength(0); expect(archived.saleLines).toHaveLength(0); expect(archived.saleComponents).toHaveLength(0); expect(archived.stockMovements).toHaveLength(0);
    const next = JSON.parse((await new DataExportService(real).create(f.admin.id, f.company.id, DataExportType.WORKSPACE_V3)).content);
    expect(next.sales).toHaveLength(1); expect(next.saleComponents).toHaveLength(2);
    const movementIds = new Set(next.stockMovements.map((m: { id: string }) => m.id));
    expect(next.saleComponents.every((part: { movementId: string }) => movementIds.has(part.movementId))).toBe(true);
  });

  it('preserves the owner-confirmed workspace deletion flow with populated grouped records', async () => {
    const f = await fixture(); expect((await complete(f, await quoted(f))).status).toBe(201);
    const password = `Synthetic-${randomUUID()}`;
    await sql.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await argon2.hash(password), f.admin.id]);
    const deleted = await request('/settings/account', f.admin.token, 'DELETE', { currentPassword: password, confirmation: f.company.name });
    expect(deleted.status).toBe(200); expect(deleted.body).toEqual({ deleted: true });
    expect(await db.orm.public.Sale.where({ companyId: f.company.id }).all()).toHaveLength(0); expect(await db.orm.public.SaleLine.where({ companyId: f.company.id }).all()).toHaveLength(0); expect(await db.orm.public.SaleComponent.where({ companyId: f.company.id }).all()).toHaveLength(0);
    expect(await db.orm.public.Company.first({ id: f.company.id })).toBeNull();
  });

  it('rejects a quote that expires while waiting for the shared item lock', async () => {
    const f = await fixture(); const quote = await quoted(f);
    await sql.query('BEGIN'); await sql.query('SELECT id FROM inventory_items WHERE id=$1 FOR UPDATE', [f.items[0]!.id]);
    const pending = complete(f, quote);
    let clock: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await expect.poll(async () => {
        await sql.query('SELECT pg_stat_clear_snapshot()');
        return Number((await sql.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND usename=$1 AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'", [runtimeRole])).rows[0].n);
      }, { timeout: 3000 }).toBeGreaterThan(0);
      clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
      await sql.query('COMMIT');
      expect((await pending).status).toBe(409); expect(await counts(f)).toEqual({ sales: 0, movements: 0 });
    } finally { clock?.mockRestore(); await sql.query('ROLLBACK'); }
  });

});
