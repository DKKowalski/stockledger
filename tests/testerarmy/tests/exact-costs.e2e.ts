import { randomUUID } from 'node:crypto';
import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';
import { fixture, token, get } from '../fixture';

async function post(path:string, auth:string, body:unknown, method='POST') {
 const response=await fetch(`${fixture.apiBase}${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth}`},body:JSON.stringify(body)});
 if(!response.ok)throw new Error(`Disposable fixture ${path} failed: ${response.status}`);return response.json();
}
test('admin agent records a documented purchase and preserves exact total value',async({app,screen,agent,browser})=>{
 if(process.env.STOCKLEDGER_TEST_EXACT_COSTS!=='1')test.skip('Requires the explicitly enabled disposable exact-cost fixture');
 const auth=await token();expect((await get('/inventory/exact-costing',auth)).available).toBe(true);
 const snapshot=await get('/inventory/snapshot',auth),place=snapshot.locations.find((p:{type:string})=>p.type==='shop');
 const suffix=randomUUID().slice(0,8),name=`Exact cost agent ${suffix}`;
 const item=await post('/inventory/items',auth,{sku:`AGENT-${suffix}`,name,category:'Test',unit:'pcs',reorderLevel:0,unitCostCents:100,sellingPriceCents:200,locationId:place.id,openingStock:0});
 let current=await get(`/inventory/items/${item.id}/exact-costing`,auth);
 const key=randomUUID();await post('/inventory/exact-costing/requests',auth,{requestKey:key,input:{kind:'checkpoint',itemId:item.id,expectedItemUpdatedAt:current.item.updatedAt,expectedUnit:'pcs',expectedCurrency:'GHS',expectedQuantity:0,expectedSequence:0,valueCents:0,costReviewId:null,reference:'Verified empty agent opening',freeStockConfirmed:false,confirmed:true}});await post(`/inventory/exact-costing/requests/${key}/apply`,auth,{});
 current=await get(`/inventory/items/${item.id}/exact-costing`,auth);const first=randomUUID();await post('/inventory/exact-costing/requests',auth,{requestKey:first,input:{kind:'receipt',itemId:item.id,expectedItemUpdatedAt:current.item.updatedAt,expectedUnit:'pcs',expectedCurrency:'GHS',expectedQuantity:0,expectedSequence:0,quantity:1,unitCostCents:100,locationId:place.id,movementDate:'2026-10-21',supplierId:null,reference:'Agent receipt first unit',freeStockConfirmed:false,confirmed:true}});await post(`/inventory/exact-costing/requests/${first}/apply`,auth,{});
 const reference=`Agent receipt ${suffix}`;
 const user=credentials.user('admin');await app.open('/login');await screen.getByLabel('Email address').fill(user.username);await screen.getByPlaceholder('Enter your password').fill(user.password);await screen.getByRole('button','Sign in').tap();await expect(screen.getByRole('link','Overview').first()).toBeVisible();await app.open('/items');
 await agent.act('In Exact stock costs, choose {product} with the Exact cost item dropdown. Record a purchase of 2 units at unit purchase cost 1.01 GHS, received at E2E shop. Use {reference} as Cost record reference. Confirm the checkbox that you checked the quantity and value against those records, then choose Review cost record. Do not confirm the cost record yet.',{params:{product:name,reference}});
 await expect(screen.getByRole('button','Confirm cost record')).toBeVisible();
 expect((await get(`/inventory/items/${item.id}/exact-costing`,auth)).valueCents).toBe(100);
 await agent.act('Confirm this reviewed cost record exactly once. Inspect that it says Cost record saved, then choose Continue to see the current total stock value.');
 await expect(browser.locator('.exact-cost-panel')).toContainText('3.02');
 const saved=await get(`/inventory/items/${item.id}/exact-costing`,auth);expect(saved).toMatchObject({quantity:3,valueCents:302,item:{unitCostCents:101}});
 const after=await get('/inventory/snapshot',auth);const receipts=after.movements.filter((m:{itemId:string})=>m.itemId===item.id);expect(receipts).toHaveLength(2);expect(receipts.reduce((sum:number,m:{quantity:number;unitCostCents:number})=>sum+m.quantity*m.unitCostCents,0)).toBe(302);
 expect(await browser.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await browser.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('stockledger:exact-cost-request:')))).toHaveLength(0);
});
