// Run only against the disposable fixture held by pricing-preview.mjs.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
const fixture = JSON.parse(await readFile(process.env.STOCKLEDGER_TEST_FIXTURE,'utf8'));
for (const key of ['webBase','apiBase']) assert.ok(['localhost','127.0.0.1'].includes(new URL(fixture[key]).hostname));
assert.match(fixture.database,/^stockledger_test_[a-f0-9]+$/);
const output=new URL('../../test-results/phase4b-final/',import.meta.url);await mkdir(output,{recursive:true});
async function request(path,token,method='GET',body){const response=await fetch(`${fixture.apiBase}${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.ok(response.ok,`${path}: ${response.status} ${JSON.stringify(data)}`);return data;}
const {accessToken:admin}=await request('/auth/login',null,'POST',fixture.administrator);assert.equal((await request('/inventory/exact-costing',admin)).available,true);
const snapshot=await request('/inventory/snapshot',admin),shop=snapshot.locations.find(p=>p.type==='shop');
const browser=await chromium.launch({headless:true});const outcomes=[];
try{for(const width of [1440,390]){
 const suffix=randomUUID().slice(0,8),name=`Exact checkout ${width} ${suffix}`;
 const item=await request('/inventory/items',admin,'POST',{sku:`CHECK-${suffix}`,name,category:'Test',unit:'pcs',reorderLevel:0,unitCostCents:100,sellingPriceCents:200,openingStock:0,locationId:shop.id});
 const operation=async(kind,extra)=>{const state=await request(`/inventory/items/${item.id}/exact-costing`,admin);const key=randomUUID();await request('/inventory/exact-costing/requests',admin,'POST',{requestKey:key,input:{kind,itemId:item.id,expectedItemUpdatedAt:state.item.updatedAt,expectedUnit:'pcs',expectedCurrency:'GHS',expectedQuantity:state.quantity,expectedSequence:state.sequence,reference:`Checkout ${width} synthetic record`,confirmed:true,freeStockConfirmed:false,...extra}});assert.equal((await request(`/inventory/exact-costing/requests/${key}/apply`,admin,'POST')).request.status,'applied');};
 await operation('checkpoint',{valueCents:0,costReviewId:null});for(const [quantity,unitCostCents]of [[1,100],[2,101]])await operation('receipt',{quantity,unitCostCents,locationId:shop.id,movementDate:'2026-10-21',supplierId:null});
 await request(`/inventory/items/${item.id}/pricing-preview`,admin,'PATCH',{expectedVersion:0,previewEnabled:true,baseUnit:'pcs',baseUnitVerified:true,package:{label:'box',size:3,priceCents:550},bulkTiers:[]});
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});const page=await context.newPage();await page.goto(`${fixture.webBase}/login`);await page.getByLabel('Email address',{exact:true}).fill(fixture.attendant.email);await page.getByPlaceholder('Enter your password',{exact:true}).fill(fixture.attendant.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('link',{name:'Overview',exact:true}).first()).toBeVisible();await page.goto(`${fixture.webBase}/sell`);
 await page.getByRole('combobox',{name:'Item',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();await page.getByLabel('Quantity',{exact:true}).fill('3');await page.getByRole('button',{name:'Review sale',exact:true}).click();await expect(page.locator('.checkout-pay dd')).toContainText('5.50');
 let posts=0;page.on('request',r=>{if(r.url().endsWith('/inventory/sales/complete')&&r.method()==='POST')posts++;});
 const saved=page.waitForResponse(r=>r.url().endsWith('/inventory/sales/complete')&&r.request().method()==='POST');await page.getByRole('button',{name:'Complete sale',exact:true}).click();const response=await saved;assert.equal(response.status(),201);const sale=await response.json();await expect(page.getByRole('status').filter({hasText:'Sale recorded'})).toContainText('5.50');
 const costed=await request(`/inventory/sales/${sale.id}`,admin),after=await request(`/inventory/items/${item.id}/exact-costing`,admin),profit=await request(`/inventory/profitability?itemId=${item.id}`,admin);
 assert.equal(posts,1);assert.equal(costed.cogsCents,302);assert.equal(costed.totalCents,550);assert.equal(after.quantity,0);assert.equal(after.valueCents,0);assert.equal(profit.summary.grossProfitCents,248);assert.equal(profit.summary.cogsCents,302);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('stockledger:sale-request:')).length),0);
 await page.screenshot({path:new URL(`attendant-exact-${width}.png`,output).pathname,animations:'disabled'});const outcome={width,saleId:sale.id,posts,quantitySold:3,revenueCents:550,cogsCents:302,grossProfitCents:248,remainingQuantity:0,remainingValueCents:0};outcomes.push(outcome);console.log(`PASS exact-cost attendant checkout at width ${width}`);await context.close();
}}finally{await browser.close();await writeFile(new URL('attendant-checkout.json',output),JSON.stringify(outcomes,null,2));}
assert.equal(outcomes.length,2);
