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
if (!url || new URL(url).hostname !== '127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) throw new Error('F01 tests require the isolated local runner');
const db = postgres<Contract>({ contractJson, url });
const v = <N extends number>(s: string) => s as Varchar<N>;
const date = new Date().toISOString().slice(0, 10);
let app: INestApplication, base: string;
async function request(path: string, token: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}/inventory${path}`, { method, headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
beforeAll(async () => {
  const compiled = '../dist/app.module.js';
  const { AppModule } = await import(compiled);
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
});
afterAll(async () => { if (app) await app.close(); await db.close(); });
async function fixture(opening = 10) {
  const company = await db.orm.public.Company.create({ name:v<120>('F01 API fixture') });
  const shop = await db.orm.public.Location.create({ companyId:company.id, name:v<120>('Shop'), type:'shop' });
  const tokens: Record<string,string> = {};
  for (const role of ['administrator','inventory_manager','shop_attendant'] as const) {
    const user = await db.orm.public.User.create({ companyId:company.id, locationId: role === 'shop_attendant' ? shop.id : null, fullName:v<120>(role), email:v<255>(`${randomUUID()}@test.invalid`),passwordHash:v<255>('unused'),role });
    tokens[role] = await app.get(JwtService).signAsync({ sub:user.id, companyId:company.id,role });
  }
  const result = await request('/items',tokens.administrator!,'POST',{name:'Value product',category:'Test',unit:'pcs',unitCostCents:100,sellingPriceCents:500,openingStock:opening,locationId:shop.id});
  expect(result.status).toBe(201);
  const itemId=result.body.id;
  const move=async(type:string,quantity:number,extra:Record<string,unknown>={})=> {
    const result=await request('/movements',type==='sale'?tokens.shop_attendant!:tokens.inventory_manager!,'POST',{itemId,locationId:shop.id,type,quantity,movementDate:date,...extra});
    expect(result.status).toBe(201); return result.body;
  };
  const snapshot=async()=> (await request('/snapshot',tokens.administrator!)).body;
  return { companyId:company.id,shop,itemId,tokens,move,snapshot };
}

describe('F01 audit scenarios through the deployed HTTP API',()=>{
  it('retains the purchase, corrects 3000 cents, and the next sale costs 100 cents a unit',async()=>{
    const f=await fixture(),purchase=await f.move('purchase',10,{unitCostCents:300});
    expect((await f.snapshot()).summary.stockValueCents).toBe(4000);
    expect((await request(`/movements/${purchase.id}`,f.tokens.shop_attendant!,'DELETE')).status).toBe(403);
    const result=await request(`/movements/${purchase.id}`,f.tokens.inventory_manager!,'DELETE');
    expect(result.status).toBe(200); expect(result.body.correctionId).toBeTruthy();
    const snapshot=await f.snapshot();
    expect(snapshot.summary).toMatchObject({closingUnits:10,stockValueCents:1000});
    expect(snapshot.items[0].unitCostCents).toBe(100);
    expect(await db.orm.public.StockMovement.first({id:purchase.id})).toEqual(purchase);
    const ledger=await request('/movements?limit=50&offset=0',f.tokens.inventory_manager!);
    expect(ledger.body.movements).toEqual(expect.arrayContaining([expect.objectContaining({correctsMovementId:purchase.id,type:'return_out',costTotalCents:3000}),expect.objectContaining({id:purchase.id,correctedByMovementId:result.body.correctionId})]));
    expect((await request(`/movements/${purchase.id}`,f.tokens.inventory_manager!,'DELETE')).status).toBe(409);
    expect((await request(`/movements/${result.body.correctionId}`,f.tokens.inventory_manager!,'DELETE')).status).toBe(409);
    const next=await f.move('sale',1);expect(next.unitCostCents).toBe(100);expect((await f.snapshot()).summary.stockValueCents).toBe(900);
  });
  it('restores original sale cost after a price rise and prices the next sale at 200 cents',async()=>{
    const f=await fixture(),original=await f.move('sale',10);
    await f.move('purchase',10,{unitCostCents:300});
    await f.move('return_in',4,{relatedMovementId:original.id});
    await f.move('return_in',6,{relatedMovementId:original.id});
    const snapshot=await f.snapshot();
    expect(snapshot.summary).toMatchObject({closingUnits:20,stockValueCents:4000});
    expect(snapshot.items[0].unitCostCents).toBe(200);
    const next=await f.move('sale',1); expect(next.unitCostCents).toBe(200);expect((await f.snapshot()).summary.stockValueCents).toBe(3800);
    expect(await db.orm.public.StockMovement.first({id:original.id})).toEqual(original);
    const staff=await request('/snapshot',f.tokens.shop_attendant!);
    expect(staff.body.items[0].pooledValueCents).toBeNull();
    expect(staff.body.movements.every((m:{costTotalCents:unknown})=>m.costTotalCents===null)).toBe(true);
  });
  it('keeps original totals through a fractional legacy sale and original-allocation return',async()=>{
    const f=await fixture(2), first=await f.move('sale',1);
    await f.move('purchase',1,{unitCostCents:300});
    await f.move('return_in',1,{relatedMovementId:first.id});
    const sold=await f.move('sale',3);
    expect(sold.costTotalCents).toBe(500);
    expect((await f.snapshot()).summary.stockValueCents).toBe(0);
    const costs=[];
    for(let i=0;i<3;i++) costs.push((await f.move('return_in',1,{relatedMovementId:sold.id})).costTotalCents);
    expect(costs).toEqual([167,166,167]);
    expect((await f.snapshot()).summary.stockValueCents).toBe(500);
    const profit=await request(`/profitability?from=${date}&to=${date}`,f.tokens.administrator!);
    expect(profit.status).toBe(200);expect(profit.body.summary.cogsCents).toBe(0);
  });
});

it('conserves a normal pool through grouped checkout and original-allocation returns',async()=>{
  const f=await fixture(2), first=await f.move('sale',1);
  await f.move('purchase',1,{unitCostCents:300});
  await f.move('return_in',1,{relatedMovementId:first.id});
  await db.orm.public.Company.where({id:f.companyId}).update({hybridPricingEnabled:true});
  const quote=await request('/sales/quote',f.tokens.shop_attendant!,'POST',{movementDate:date,lines:[{itemId:f.itemId,quantity:3,expectedVersion:0,expectedRetailPriceCents:500}]});
  expect(quote.status).toBe(201);
  const sale=await request('/sales/complete',f.tokens.shop_attendant!,'POST',{quoteToken:quote.body.quoteToken,idempotencyKey:randomUUID()});
  expect(sale.status).toBe(201);
  const line=await db.orm.public.SaleLine.first({companyId:f.companyId,saleId:sale.body.id});
  expect(line).toMatchObject({cogsCents:500,prospectiveCost:true});
  expect((await f.snapshot()).summary.stockValueCents).toBe(0);
  await f.move('purchase',1,{unitCostCents:900});
  const source=await request(`/sale-returns/sources/grouped/${sale.body.id}`,f.tokens.administrator!);
  expect(source.status).toBe(200);
  const key=randomUUID();
  const prepared=await request('/sale-returns/requests',f.tokens.administrator!,'POST',{requestKey:key,input:{sourceType:'grouped',sourceId:sale.body.id,kind:'return',expectedRevision:source.body.revision,movementDate:date,reason:'Original value',reference:'F01-RETURN',confirmed:true,lines:[{itemId:f.itemId,quantity:3,disposition:'resellable'}]}});
  expect(prepared.status).toBe(201);
  const returned=await request(`/sale-returns/requests/${key}/apply`,f.tokens.administrator!,'POST');
  expect(returned.status).toBe(201);
  expect((await f.snapshot()).summary).toMatchObject({closingUnits:4,stockValueCents:1400});
  expect((await db.orm.public.SaleLine.first({id:line!.id}))!.cogsCents).toBe(500);
});
