import { test, expect, type Page } from '@playwright/test';
import type { ExactCostState, ExactCostRequest, ExactCostInput } from '../../apps/web/src/types';
const companyId='31000000-0000-4000-8000-000000000088',itemId='51000000-0000-4000-8000-000000000088',shopId='32000000-0000-4000-8000-000000000088';
const item={id:itemId,name:'Precise test item',sku:'EXACT',category:'Test',unit:'pcs',unitCostCents:100,sellingPriceCents:200,reorderLevel:0,isActive:true,createdAt:'2026-10-21T00:00:00Z',updatedAt:'2026-10-21T00:00:00Z',preciseCosting:true};
const initial:ExactCostState={available:true,developmentOnly:true,currency:'GHS',allowNegativeStock:false,hasNegativePosition:false,item,quantity:1,valueCents:100,sequence:1,checkpoint:{id:'checkpoint',reference:'Verified opening',openingQuantity:0,openingValueCents:0},positions:[{locationId:shopId,name:'Shop',quantity:1}],costReview:{available:true,developmentOnly:true,currency:'GHS',item,state:'unconfirmed',review:null}};
function fixture() { return {current:structuredClone(initial),requests:new Map<string,ExactCostRequest>(),prepares:0,applies:0,loseApply:false,losePrepare:false,available:true}; }
type Fixture=ReturnType<typeof fixture>;
async function session(page:Page,f:Fixture) {
 await page.route('**/auth/refresh',r=>r.fulfill({json:{accessToken:'test.session.token',user:{id:'test-admin',companyId,fullName:'Test admin',email:'test@example.invalid',role:'administrator',locationId:null,isActive:true,isDemo:false,setupPending:false}}}));
 await page.route('**/onboarding',r=>r.fulfill({json:{completed:true,company:{id:companyId,name:'Test business',businessType:'mixed',inventorySource:'paper'},counts:{locations:1,items:1,movements:1,teammates:1}}}));
 await page.route('**/settings',r=>r.fulfill({json:{id:companyId,name:'Test business',currency:'GHS',timeZone:'Africa/Accra',defaultUnit:'pcs',defaultReorderLevel:0,defaultLocationId:shopId,itemTerm:'item',shopTerm:'shop',warehouseTerm:'warehouse'}}));
 await page.route('**/inventory/snapshot**',r=>r.fulfill({json:{items:[item],locations:[{id:shopId,name:'Shop',type:'shop'}],positions:[],movements:[],periodMovements:[],summary:{closingUnits:f.current.quantity,stockValueCents:f.current.valueCents,lowStockItems:0,damagedUnits:0,deadStockLines:0}}}));
 for(const path of ['pricing-preview','cost-review'])await page.route(`**/inventory/${path}`,r=>r.fulfill({json:{available:false}}));
 await page.route('**/inventory/exact-costing',r=>r.fulfill({json:{available:f.available,hasEnrolledItems:true}}));
 await page.route(`**/inventory/items/${itemId}/exact-costing`,r=>r.fulfill({json:f.current}));
 await page.route('**/inventory/exact-costing/requests',async r=>{
  f.prepares++;const body=r.request().postDataJSON() as {requestKey:string;input:ExactCostInput};
  f.requests.set(body.requestKey,{request:{key:body.requestKey,status:'prepared',input:body.input,createdAt:new Date().toISOString(),finishedAt:null}});
  if(f.losePrepare){f.losePrepare=false;await r.abort('failed');}else await r.fulfill({status:201,json:f.requests.get(body.requestKey)});
 });
 await page.route('**/inventory/exact-costing/requests/*',r=>r.fulfill({json:f.requests.get(r.request().url().split('/').at(-1)!)??{request:null}}));
 await page.route('**/inventory/exact-costing/requests/*/apply',async r=>{
  const key=r.request().url().split('/').at(-2)!,record=f.requests.get(key)!;
  if(record.request?.status==='prepared') {f.applies++;f.current={...f.current,quantity:3,valueCents:302,sequence:2};record.request.status='applied';record.entry={id:'entry',quantityAfter:3,valueAfterCents:302};}
  if(f.loseApply){f.loseApply=false;await r.abort('failed');}else await r.fulfill({status:201,json:record});
 });
 await page.route('**/inventory/exact-costing/requests/*/cancel',r=>{const key=r.request().url().split('/').at(-2)!,record=f.requests.get(key)??{request:{key,status:'cancelled',input:null,createdAt:'now',finishedAt:'now'}};if(record.request?.status==='prepared')record.request.status='cancelled';f.requests.set(key,record);return r.fulfill({json:record});});
}
async function form(page:Page) {
 await page.goto('/items');await page.getByRole('combobox',{name:'Exact cost item',exact:true}).click();await page.getByRole('option',{name:item.name,exact:true}).click();
 const panel=page.locator('.exact-cost-panel');await panel.getByLabel('Purchase quantity',{exact:true}).fill('2');await panel.getByLabel('Unit purchase cost (GHS)',{exact:true}).fill('1.01');await panel.getByLabel('Cost record reference',{exact:true}).fill('Invoice QA-302');await panel.getByLabel('I checked the quantity and value against the referenced records.').check();return panel;
}
for(const width of [1440,390])test(`recovers a committed exact purchase with only an opaque stored key at ${width}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:1000});const f=fixture();await session(page,f);const panel=await form(page);
 await panel.getByRole('button',{name:'Review cost record',exact:true}).click();await expect(panel.getByRole('button',{name:'Confirm cost record',exact:true})).toBeVisible();expect(f.applies).toBe(0);
 const stored=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('stockledger:exact-cost-request:')));expect(stored).toHaveLength(1);expect(stored[0]![1]).toMatch(/^[a-f0-9-]{36}$/);expect(JSON.stringify(stored)).not.toContain('1.01');
 f.loseApply=true;await panel.getByRole('button',{name:'Confirm cost record',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();expect(f.applies).toBe(1);
 await page.reload();await expect(panel.getByRole('status')).toHaveText('Cost record saved.');await panel.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('combobox',{name:'Exact cost item',exact:true}).click();await page.getByRole('option',{name:item.name,exact:true}).click();await expect(panel).toContainText('3.02');expect(f.prepares).toBe(1);expect(f.applies).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await panel.screenshot({path:testInfo.outputPath(`exact-cost-${width}.png`)});
});
test('recovers a lost preparation without creating another request and cancels before applying',async({page})=>{
 const f=fixture();f.losePrepare=true;await session(page,f);const panel=await form(page);await panel.getByRole('button',{name:'Review cost record',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();
 await page.reload();await expect(panel.getByRole('button',{name:'Confirm cost record',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Cancel cost request',exact:true}).click();await expect(panel.getByRole('status')).toContainText('Request cancelled');expect(f.prepares).toBe(1);expect(f.applies).toBe(0);
});
test('two tabs submitting together prepare one durable cost request',async({page,context})=>{
 const f=fixture();const second=await context.newPage();await session(page,f);await session(second,f);await form(page);await form(second);
 await Promise.all([page,second].map(p=>p.locator('.exact-cost-panel form').evaluate(form=>(form as HTMLFormElement).requestSubmit())));
 await expect.poll(()=>f.prepares).toBe(1);await expect(page.locator('.exact-cost-panel').getByRole('button',{name:'Confirm cost record',exact:true})).toBeVisible();await expect(second.locator('.exact-cost-panel').getByRole('button',{name:'Confirm cost record',exact:true})).toBeVisible();expect(f.applies).toBe(0);
});
