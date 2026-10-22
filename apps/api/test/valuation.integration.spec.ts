import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import postgres from '@prisma/orm-postgres/runtime';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d.js';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

const url=process.env.INVENTORY_TEST_DATABASE_URL!;
if (!url || new URL(url).hostname!=='127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) throw new Error('Use the isolated integration runner');
const db=postgres<Contract>({contractJson,url});
const sql=new pg.Client({connectionString:url});
const runtimeRole=`stockledger_test_${randomUUID().replaceAll('-','')}`;
const v=<N extends number>(s:string)=>s as Varchar<N>;
let app:INestApplication,base:string,config:ConfigService,jwt:JwtService;
async function request(path:string,token:string,method='GET',body?:unknown) {
 const response=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
beforeAll(async()=>{
 await sql.connect(); await sql.query(`CREATE ROLE "${runtimeRole}" LOGIN PASSWORD 'isolated-runtime-only' IN ROLE stockledger_app`);
 const runtimeUrl=new URL(url);runtimeUrl.username=runtimeRole;runtimeUrl.password='isolated-runtime-only';
 const runtime=postgres<Contract>({contractJson,url:runtimeUrl.toString()});
 const compiled='../dist/app.module.js',prismaModule='../dist/prisma/prisma.service.js';
 const {AppModule}=await import(compiled),{PrismaService}=await import(prismaModule);
 app=await NestFactory.create(AppModule,{logger:false});Object.assign(app.get(PrismaService),{client:runtime});
 await app.listen(0,'127.0.0.1');base=await app.getUrl();config=app.get(ConfigService);jwt=app.get(JwtService);
});
afterAll(async()=>{if(app)await app.close();await db.close();await sql.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);await sql.end();});
async function fixture(opening=0,cost=100) {
 config.set('app.environment','test');
 const company=await db.orm.public.Company.create({name:v<120>('Exact costing synthetic')});
 const shop=await db.orm.public.Location.create({companyId:company.id,name:v<120>('Shop'),type:'shop'});
 const tokens={} as Record<'admin'|'attendant'|'manager',string>,users={} as Record<string,string>;
 for(const [key,role] of [['admin','administrator'],['attendant','shop_attendant'],['manager','inventory_manager']] as const){
 const user=await db.orm.public.User.create({companyId:company.id,role,locationId:role==='shop_attendant'?shop.id:null,fullName:v<120>(key),email:v<255>(`${randomUUID()}@test.invalid`),passwordHash:v<255>('unused')});
 tokens[key]=await jwt.signAsync({sub:user.id,companyId:company.id,role});users[key]=user.id;}
 const item=await db.orm.public.InventoryItem.create({companyId:company.id,sku:v<40>('EXACT'),name:v<120>('Exact item'),category:v<80>('Test'),unit:v<20>('pcs'),unitCostCents:cost,sellingPriceCents:200});
 await db.orm.public.LocationStock.create({companyId:company.id,itemId:item.id,locationId:shop.id,openingStock:opening});
 for(const key of ['exactCostingCompanyIds','costReadinessCompanyIds','saleCompletionCompanyIds','pricingPreviewCompanyIds'])config.set(`app.${key}`,[company.id]);
 return {company,shop,item,tokens,users,path:`/inventory/items/${item.id}/exact-costing`};
}
type F=Awaited<ReturnType<typeof fixture>>;
const current=(f:F)=>request(f.path,f.tokens.admin);
async function input(f:F,kind='checkpoint',extra:Record<string,unknown>={}) {
 const {body:c}=await current(f);
 return {itemId:f.item.id,kind,expectedItemUpdatedAt:c.item.updatedAt,expectedUnit:c.item.unit,expectedCurrency:c.currency,expectedQuantity:c.quantity,expectedSequence:c.sequence,reference:'Synthetic invoice/stock sheet',confirmed:true,
 ...(kind==='receipt'?{locationId:f.shop.id,quantity:1,unitCostCents:100,movementDate:'2026-10-21',freeStockConfirmed:false,supplierId:null}:{valueCents:0,freeStockConfirmed:false,...(kind==='checkpoint'?{costReviewId:c.costReview.review?.id??null}:{reason:'Verified current-value correction'})}),...extra};
}
async function prepare(f:F,data:unknown,key=randomUUID()){const r=await request('/inventory/exact-costing/requests',f.tokens.admin,'POST',{requestKey:key,input:data});return {...r,key};}
const apply=(f:F,key:string)=>request(`/inventory/exact-costing/requests/${key}/apply`,f.tokens.admin,'POST');
const cancel=(f:F,key:string)=>request(`/inventory/exact-costing/requests/${key}/cancel`,f.tokens.admin,'POST');
async function operation(f:F,kind:string,extra:Record<string,unknown>={}){const prepared=await prepare(f,await input(f,kind,extra));expect(prepared.status).toBe(201);const result=await apply(f,prepared.key);expect(result.body,JSON.stringify(result.body)).toHaveProperty('request.status','applied');return result;}
async function enroll(f:F){return operation(f,'checkpoint');}
async function pricing(f:F){return request(`/inventory/items/${f.item.id}/pricing-preview`,f.tokens.admin,'PATCH',{expectedVersion:0,baseUnit:'pcs',baseUnitVerified:true,previewEnabled:true,package:null,bulkTiers:[]});}
async function quote(f:F,quantity=1){return request('/inventory/sales/quote',f.tokens.attendant,'POST',{movementDate:'2026-10-21',lines:[{itemId:f.item.id,quantity,quantityUnit:'base',expectedVersion:1,expectedRetailPriceCents:200}]});}
async function sell(f:F,quantity=1){const q=await quote(f,quantity);expect(q.status,JSON.stringify(q.body)).toBe(201);const r=await request('/inventory/sales/complete',f.tokens.attendant,'POST',{idempotencyKey:randomUUID(),quoteToken:q.body.quoteToken});expect(r.status,JSON.stringify(r.body)).toBe(201);return r.body;}

describe('prospective exact costing with durable admin intentions',()=>{
 it('is default-off, refuses production writes, protects roles and rejects unknown inputs',async()=>{
  const f=await fixture();const data=await input(f);config.set('app.exactCostingCompanyIds',[]);
  expect((await request('/inventory/exact-costing',f.tokens.admin)).body.available).toBe(false);
  expect((await prepare(f,data)).status).toBe(403);config.set('app.exactCostingCompanyIds',[f.company.id]);config.set('app.environment','production');expect((await prepare(f,data)).status).toBe(403);
  config.set('app.environment','test');
  for(const token of [f.tokens.attendant,f.tokens.manager]){expect((await request(f.path,token)).status).toBe(403);expect((await request('/inventory/exact-costing/requests',token,'POST',{requestKey:randomUUID(),input:data})).status).toBe(403);}
  expect((await prepare(f,{...data,guessedHistoricalCost:100})).status).toBe(400);
  for(const invalid of [{quantity:1.5},{unitCostCents:1.5}]) expect((await prepare(f,await input(f,'receipt',invalid))).status).toBe(400);
 });
 it('requires independently verified nonempty opening values; never guesses from rounded average',async()=>{
  const f=await fixture(3,101);const bad=await prepare(f,await input(f,'checkpoint',{valueCents:302}));expect((await apply(f,bad.key)).status).toBe(409);
  const review=await request(`/inventory/items/${f.item.id}/cost-review`,f.tokens.admin,'POST',{expectedCostCents:101,expectedUnit:'pcs',expectedCurrency:'GHS',expectedItemUpdatedAt:f.item.updatedAt,source:'opening_records',reference:'Independent opening sheet',confirmed:true});expect(review.status).toBe(201);
  await operation(f,'checkpoint',{valueCents:302,costReviewId:review.body.review.id});
  expect((await current(f)).body).toMatchObject({quantity:3,valueCents:302,item:{unitCostCents:101}});
  expect(await db.orm.public.StockMovement.where({companyId:f.company.id}).all()).toHaveLength(0);
 });
 it('preserves 302 cents through exact receipts and three separate sales, with no cost disclosure to attendant',async()=>{
  const f=await fixture();await enroll(f);await operation(f,'receipt');await operation(f,'receipt',{quantity:2,unitCostCents:101});
  expect((await pricing(f)).status).toBe(200);
  expect((await current(f)).body).toMatchObject({quantity:3,valueCents:302});
  const snapshot=await request('/inventory/snapshot',f.tokens.admin);expect(snapshot.body.summary.stockValueCents).toBe(302);
  const costs=[];
  for(let i=0;i<3;i++){const sale=await sell(f);expect(sale).not.toHaveProperty('cogsCents');expect(sale.lines[0]).not.toHaveProperty('cogsCents');const saved=await db.orm.public.Sale.first({id:sale.id});costs.push(saved!.cogsCents);}
  expect(costs).toEqual([101,101,100]);expect((await current(f)).body).toMatchObject({quantity:0,valueCents:0});
  expect((await request('/inventory/profitability',f.tokens.admin)).body.summary.cogsCents).toBe(302);
 });
 it('splits pricing portions into truthful movement costs while recording the exact line total',async()=>{
  const f=await fixture();await enroll(f);await operation(f,'receipt');await operation(f,'receipt',{quantity:2,unitCostCents:101});await pricing(f);
  const sale=await sell(f,3);const line=await db.orm.public.SaleLine.first({saleId:sale.id});expect(line).toMatchObject({quantity:3,cogsCents:302,unitCostCents:101});expect(line!.valuationCheckpointId).not.toBeNull();
  const movements=await db.orm.public.StockMovement.where({companyId:f.company.id,type:'sale'}).all();
  expect(movements.reduce((sum,m)=>sum+m.quantity,0)).toBe(3);expect(movements.reduce((sum,m)=>sum+m.quantity*m.unitCostCents!,0)).toBe(302);expect(movements.reduce((sum,m)=>sum+m.quantity*m.unitPriceCents!,0)).toBe(600);
 });
 it('same-key concurrent apply deduplicates, a fresh stale key fails, and recovery survives flag-off',async()=>{
  const f=await fixture();await enroll(f);const receipt=await input(f,'receipt');const p=await prepare(f,receipt);
  const results=await Promise.all([1,2,3].map(()=>apply(f,p.key)));expect(results.map(r=>r.status)).toEqual([201,201,201]);expect(new Set(results.map(r=>r.body.entry.id)).size).toBe(1);
  const stale=await prepare(f,receipt);expect((await apply(f,stale.key)).status).toBe(409);
  config.set('app.exactCostingCompanyIds',[]);expect((await apply(f,p.key)).body.request.status).toBe('applied');expect((await cancel(f,p.key)).body.request.status).toBe('applied');
  expect((await cancel(f,stale.key)).body.request.status).toBe('cancelled');expect((await current(f)).body).toMatchObject({quantity:1,valueCents:100,available:false});
 });
 it('cancelled tombstones fence late prepare/apply and never delete committed receipts',async()=>{
  const f=await fixture();await enroll(f);const key=randomUUID(),receipt=await input(f,'receipt');
  expect((await cancel(f,key)).body.request.status).toBe('cancelled');expect((await prepare(f,receipt,key)).body.request.status).toBe('cancelled');expect((await apply(f,key)).body.request.status).toBe('cancelled');expect((await current(f)).body.quantity).toBe(0);
  const p=await prepare(f,receipt);await apply(f,p.key);expect((await cancel(f,p.key)).body.request.status).toBe('applied');expect((await current(f)).body.quantity).toBe(1);
 });
 it('stales a quote when precise value changes even if the displayed average is unchanged',async()=>{
  const f=await fixture();await enroll(f);await operation(f,'receipt',{quantity:3,unitCostCents:101});await pricing(f);const old=await quote(f);
  expect(JSON.stringify(old.body)).not.toMatch(/valueCents|cogsCents|unitCostCents|checkpoint/);
  await operation(f,'value_adjustment',{valueCents:302});expect((await current(f)).body.item.unitCostCents).toBe(101);
  const result=await request('/inventory/sales/complete',f.tokens.attendant,'POST',{idempotencyKey:randomUUID(),quoteToken:old.body.quoteToken});expect(result.status).toBe(409);expect(await db.orm.public.Sale.where({companyId:f.company.id}).all()).toHaveLength(0);
  await operation(f,'value_adjustment',{valueCents:0,freeStockConfirmed:false,reason:'Verified current-value write-down, not a free acquisition'});
  expect((await current(f)).body).toMatchObject({quantity:3,valueCents:0});
 });
 it('refuses unsupported legacy writers and direct cost changes for enrolled items even after flags turn off',async()=>{
  const f=await fixture();await enroll(f);await operation(f,'receipt');await pricing(f);config.set('app.exactCostingCompanyIds',[]);
  for(const type of ['purchase','damage','transfer','return_out','sale']){const r=await request('/inventory/movements',type==='sale'?f.tokens.attendant:f.tokens.admin,'POST',{itemId:f.item.id,locationId:f.shop.id,type,quantity:1,unitCostCents:100,movementDate:'2026-10-21'});expect(r.status).toBe(409);}
  expect((await request('/inventory/stock-counts',f.tokens.admin,'POST',{itemId:f.item.id,locationId:f.shop.id,countedQuantity:1,countedAt:'2026-10-21'})).status).toBe(409);
  expect((await request(`/inventory/items/${f.item.id}`,f.tokens.admin,'PATCH',{unitCostCents:101})).status).toBe(409);
  expect((await request(`/inventory/items/${f.item.id}`,f.tokens.admin,'PATCH',{unit:'box'})).status).toBe(409);
  const movement=await db.orm.public.StockMovement.first({companyId:f.company.id});expect((await request(`/inventory/movements/${movement!.id}`,f.tokens.admin,'DELETE')).status).toBe(409);
  expect((await quote(f)).status).toBe(403);expect((await current(f)).body).toMatchObject({quantity:1,valueCents:100});
 });
 it('detects ledger divergence and refuses overflow/zero free cost without partial stock writes',async()=>{
  const f=await fixture();await enroll(f);const free=await prepare(f,await input(f,'receipt',{unitCostCents:0}));expect((await apply(f,free.key)).status).toBe(409);
  const tooLarge=await prepare(f,await input(f,'receipt',{quantity:2147483647,unitCostCents:2}));expect(tooLarge.status).toBe(400);
  expect(await db.orm.public.StockMovement.where({companyId:f.company.id}).all()).toHaveLength(0);
  await sql.query('UPDATE location_stocks SET opening_stock=1 WHERE company_id=$1',[f.company.id]);expect((await current(f)).status).toBe(409);
 });
 it('enforces tenant isolation and database immutability, retains new records in v4 without changing v3',async()=>{
  const f=await fixture();await enroll(f);const receipt=await operation(f,'receipt');const foreign=await fixture();
  expect((await request(f.path,foreign.tokens.admin)).status).toBe(404);
  await sql.query('BEGIN');try{await sql.query(`SET LOCAL ROLE "${runtimeRole}"`);await sql.query("SELECT set_config('app.current_company_id',$1,true)",[foreign.company.id]);expect((await sql.query('SELECT * FROM inventory_valuation_entries')).rows).toHaveLength(0);}finally{await sql.query('ROLLBACK');}
  for(const query of ['UPDATE inventory_valuation_entries SET value_after_cents=0','UPDATE inventory_valuation_checkpoints SET opening_value_cents=5','UPDATE inventory_valuation_requests SET input_json=\'{}\'']){
   await sql.query('BEGIN');try{await sql.query(`SET LOCAL ROLE "${runtimeRole}"`);await sql.query("SELECT set_config('app.current_company_id',$1,true)",[f.company.id]);await expect(sql.query(query)).rejects.toHaveProperty('code','42501');}finally{await sql.query('ROLLBACK');}
  }
  const archive=await request('/settings/exports/workspace-v4',f.tokens.admin);expect(archive.status).toBe(200);expect(JSON.stringify(archive.body)).toContain(receipt.body.entry.id);
  const old=await request('/settings/exports/workspace-v3',f.tokens.admin);expect(JSON.stringify(old.body)).not.toContain('valuationEntries');
 });
 it('includes empty receiving locations and prevents currency/negative-stock changes after enrollment',async()=>{
  const f=await fixture();expect((await current(f)).body.positions).toEqual([{locationId:f.shop.id,name:'Shop',quantity:0}]);await enroll(f);
  expect((await request('/settings',f.tokens.admin,'PATCH',{name:'Exact business',businessType:'mixed',contactEmail:'admin@test.invalid',phone:'',address:'',currency:'USD',timeZone:'Africa/Accra',dateFormat:'day_month_year'})).status).toBe(409);
  expect((await request('/settings/inventory',f.tokens.admin,'PATCH',{defaultLocationId:f.shop.id,defaultUnit:'pcs',defaultReorderLevel:0,skuPrefix:'T',nextSkuNumber:1,allowNegativeStock:true,requirePurchaseSource:false,requireAdjustmentReason:true})).status).toBe(409);
  expect((await current(f)).body).toMatchObject({currency:'GHS',allowNegativeStock:false});
 });
 it('serializes different-key requests against one pool revision and cannot oversell an exact item',async()=>{
  const f=await fixture();await enroll(f);const data=await input(f,'receipt',{quantity:2,unitCostCents:101});const a=await prepare(f,data),b=await prepare(f,data);
  const applied=await Promise.all([apply(f,a.key),apply(f,b.key)]);expect(applied.map(r=>r.status).sort()).toEqual([201,409]);expect((await current(f)).body).toMatchObject({quantity:2,valueCents:202});
  await pricing(f);const first=await quote(f,2),second=await quote(f,2);
  const sales=await Promise.all([first,second].map(q=>request('/inventory/sales/complete',f.tokens.attendant,'POST',{idempotencyKey:randomUUID(),quoteToken:q.body.quoteToken})));
  expect(sales.map(r=>r.status).sort()).toEqual([201,409]);expect((await current(f)).body).toMatchObject({quantity:0,valueCents:0});expect(await db.orm.public.Sale.where({companyId:f.company.id}).all()).toHaveLength(1);
 });
 it('waits behind a legacy receipt, then rejects stale opening verification without adding a checkpoint',async()=>{
  const f=await fixture();const p=await prepare(f,await input(f));const blocker=new pg.Client({connectionString:url});await blocker.connect();let pending:ReturnType<typeof apply>|undefined;
  try{
   await blocker.query('BEGIN');await blocker.query('SELECT id FROM inventory_items WHERE id=$1 FOR UPDATE',[f.item.id]);pending=apply(f,p.key);
   const deadline=Date.now()+5000;let waiting=false;
   while(Date.now()<deadline){const result=await sql.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename=$1 AND wait_event_type='Lock' AND query LIKE '%inventory_items%FOR UPDATE%'",[runtimeRole]);if(result.rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}
   expect(waiting).toBe(true);await blocker.query("INSERT INTO stock_movements(id,company_id,item_id,location_id,type,quantity,unit_cost_cents,movement_date) VALUES ($1,$2,$3,$4,'purchase',1,100,'2026-10-21')",[randomUUID(),f.company.id,f.item.id,f.shop.id]);await blocker.query('COMMIT');
   expect((await pending).status).toBe(409);expect(await db.orm.public.InventoryValuationCheckpoint.where({companyId:f.company.id}).all()).toHaveLength(0);
  }finally{await blocker.query('ROLLBACK');await blocker.end();if(pending)await pending;}
 });

 it('removes precise dependencies only through the verified owner workspace-deletion flow',async()=>{
  const f=await fixture();await enroll(f);await operation(f,'receipt');await pricing(f);await sell(f);
  await db.orm.public.User.where({id:f.users.admin!}).update({passwordHash:v<255>(await argon2.hash('Synthetic-only-delete-password'))});
  expect((await request('/settings/account',f.tokens.admin,'DELETE',{confirmation:f.company.name,currentPassword:'Synthetic-only-delete-password'})).status).toBe(200);
  for(const table of ['inventory_valuation_requests','inventory_valuation_checkpoints','inventory_valuation_entries','sale_lines','sales','stock_movements'])expect((await sql.query(`SELECT count(*)::int n FROM ${table} WHERE company_id=$1`,[f.company.id])).rows[0].n).toBe(0);
 });

});
