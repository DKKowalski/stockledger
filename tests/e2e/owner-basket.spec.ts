import {randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import pg from 'pg';
import * as argon2 from 'argon2';
const url=process.env.INVENTORY_TEST_DATABASE_URL;
if(!url || new URL(url).hostname!=='127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) throw Error('Owner basket requires the isolated local database');
for(const width of [390,1440]) test(`owner basket preserves chosen shop, recovery and receipt at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:1000});await page.setExtraHTTPHeaders({'X-Forwarded-For':width===390?'198.51.100.231':'198.51.100.232'});
  const db=new pg.Client({connectionString:url});await db.connect();
  const company=randomUUID(),owner=randomUUID(),shop=randomUUID(),other=randomUUID(),items=[randomUUID(),randomUUID()],email=`${owner}@example.invalid`,password=randomUUID();
  try {
    await db.query("INSERT INTO companies(id,name,onboarding_completed_at,updated_at) VALUES ($1,'Owner basket',now(),now())",[company]);
    await db.query("INSERT INTO locations(id,company_id,name,type,updated_at) VALUES ($1,$3,'First shop','shop',now()),($2,$3,'Second shop','shop',now())",[other,shop,company]);
    await db.query("INSERT INTO users(id,company_id,full_name,email,password_hash,role,email_verified_at,updated_at) VALUES ($1,$2,'Basket owner',$3,$4,'administrator',now(),now())",[owner,company,email,await argon2.hash(password)]);
    for(const [index,item] of items.entries()) {
      await db.query("INSERT INTO inventory_items(id,company_id,sku,name,category,unit,unit_cost_cents,selling_price_cents,updated_at) VALUES ($1,$2,$3,$4,'Test','pcs',100,200,now())",[item,company,`OWNER-${index}`,`Owner basket ${index+1}`]);
      for(const [place,quantity] of [[shop,10],[other,1]]) await db.query('INSERT INTO location_stocks(id,company_id,item_id,location_id,opening_stock,updated_at) VALUES ($1,$2,$3,$4,$5,now())',[randomUUID(),company,item,place,quantity]);
    }
    await page.goto('/login');await page.getByLabel('Email address',{exact:true}).fill(email);await page.getByPlaceholder('Enter your password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL('/');
    if(width===390) await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Sell',exact:true}).click();
    const location=page.getByRole('combobox',{name:'Shop for this sale',exact:true});await location.click();await page.getByRole('option',{name:'Second shop',exact:true}).click();
    await page.getByRole('link',{name:'Basket sale',exact:true}).click();
    for(const name of ['Owner basket 1','Owner basket 2']) {
      await page.getByRole('combobox',{name:'Item',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();
      await expect(page.getByText('10 pcs available at Second shop',{exact:true})).toBeVisible();
      await page.getByLabel('Quantity',{exact:true}).fill('2');await page.getByRole('button',{name:'Add to basket',exact:true}).click();
    }
    const quoted=page.waitForRequest(r=>r.url().includes('/inventory/sales/quote')&&r.method()==='POST');
    await page.getByRole('button',{name:'Review sale',exact:true}).click();expect((await quoted).postDataJSON().locationId).toBe(shop);
    await expect(page.locator('.checkout-pay dd')).toContainText('8.00');
    await page.getByRole('combobox',{name:'Payment record (manual)',exact:true}).click();await page.getByRole('option',{name:'Cash received',exact:true}).click();await page.getByLabel('Amount received',{exact:true}).fill('10.00');
    await page.screenshot({path:testInfo.outputPath(`owner-basket-${width}.png`),fullPage:true});
    await page.route('**/inventory/sales/complete',async route=>{const result=await route.fetch();expect(result.status()).toBe(201);await route.abort('connectionreset');});
    await page.getByRole('button',{name:'Complete sale',exact:true}).click();await expect(page.getByRole('heading',{name:'Confirm pending sale',exact:true})).toBeVisible();
    if(await location.isEnabled()) {await location.click();await page.getByRole('option',{name:'First shop',exact:true}).click();}
    await expect(location).toContainText('Second shop');
    await page.reload();await expect(location).toContainText('Second shop');await expect(location).toBeDisabled();
    await page.getByRole('button',{name:'Check sale status',exact:true}).click();await expect(page.getByRole('link',{name:'View customer receipt',exact:true})).toBeVisible();
    const saved=(await db.query('SELECT created_by_user_id,location_id,total_cents,tender_method,amount_received_cents FROM sales WHERE company_id=$1',[company])).rows;
    expect(saved).toEqual([{created_by_user_id:owner,location_id:shop,total_cents:800,tender_method:'cash',amount_received_cents:1000}]);
    expect((await db.query('SELECT count(*)::int n FROM stock_movements WHERE company_id=$1 AND location_id=$2',[company,other])).rows[0].n).toBe(0);
    await page.getByRole('link',{name:'View customer receipt',exact:true}).click();const receipt=page.getByRole('article',{name:'Customer receipt',exact:true});
    await expect(receipt).toContainText('Second shop');await expect(receipt).toContainText('8.00');await expect(receipt).toContainText('Change to give:');await expect(receipt).toContainText('2.00');
    await expect(receipt).not.toContainText(/COGS|unit cost|cost of goods/i);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`owner-receipt-${width}.png`),fullPage:true});
  } finally {await db.end();}
});
