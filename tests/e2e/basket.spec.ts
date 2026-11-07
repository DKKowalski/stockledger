import {randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import pg from 'pg';
import * as argon2 from 'argon2';
const url=process.env.INVENTORY_TEST_DATABASE_URL;
if(!url || new URL(url).hostname!=='127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) throw Error('Basket tests require the isolated local database');
for(const width of [390,1440]) test(`retail basket edits, revalidates atomically and recovers a lost response at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});
  const db=new pg.Client({connectionString:url});await db.connect();
  const company=randomUUID(),shop=randomUUID(),user=randomUUID(),items=[randomUUID(),randomUUID()],password=randomUUID(),email=`${user}@example.invalid`;
  try {
    await db.query("INSERT INTO companies(id,name,onboarding_completed_at,updated_at) VALUES ($1,'Basket shop',now(),now())",[company]);
    await db.query("INSERT INTO locations(id,company_id,name,type,updated_at) VALUES ($1,$2,'Basket place','shop',now())",[shop,company]);
    await db.query("INSERT INTO users(id,company_id,location_id,full_name,email,password_hash,role,email_verified_at,invitation_accepted_at,updated_at) VALUES ($1,$2,$3,'Basket attendant',$4,$5,'shop_attendant',now(),now(),now())",[user,company,shop,email,await argon2.hash(password)]);
    for(const [n,item] of items.entries()) {
      await db.query("INSERT INTO inventory_items(id,company_id,sku,name,category,unit,unit_cost_cents,selling_price_cents,updated_at) VALUES ($1,$2,$3,$4,'Test','pcs',100,200,now())",[item,company,`BASKET-${n}`,`Basket item ${n+1}`]);
      await db.query('INSERT INTO location_stocks(id,company_id,item_id,location_id,opening_stock,updated_at) VALUES ($1,$2,$3,$4,10,now())',[randomUUID(),company,item,shop]);
    }
    await page.goto('/login');await page.getByLabel('Email address',{exact:true}).fill(email);await page.getByPlaceholder('Enter your password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL('/');
    await page.getByRole('main').getByRole('link',{name:'Sell',exact:true}).click();
    await page.getByRole('link',{name:'Basket sale',exact:true}).click();
    const add=async(name:string,qty:string)=>{await page.getByRole('combobox',{name:'Item',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();await page.getByLabel('Quantity',{exact:true}).fill(qty);await page.getByRole('button',{name:'Add to basket',exact:true}).click();};
    await add('Basket item 1','2');await add('Basket item 2','3');
    await page.getByLabel('Quantity for Basket item 1',{exact:true}).fill('3');
    await page.getByRole('button',{name:'Remove Basket item 2',exact:true}).click();
    await expect(page.getByLabel('Quantity for Basket item 2',{exact:true})).toHaveCount(0);
    await add('Basket item 2','2');
    await page.getByRole('button',{name:'Review sale',exact:true}).click();await expect(page.locator('.checkout-pay dd')).toContainText('10.00');
    await db.query('UPDATE inventory_items SET selling_price_cents=250 WHERE id=$1',[items[0]]);
    await page.getByRole('button',{name:'Complete sale',exact:true}).click();await expect(page.getByRole('alert')).toContainText(/price.*changed/i);
    expect((await db.query('SELECT count(*)::int n FROM sales WHERE company_id=$1',[company])).rows[0].n).toBe(0);
    await expect(page.getByLabel('Quantity for Basket item 1',{exact:true})).toHaveValue('3');
    await page.getByRole('button',{name:'Refresh stock and prices',exact:true}).click();
    await page.getByRole('button',{name:'Review sale',exact:true}).click();await expect(page.locator('.checkout-pay dd')).toContainText('11.50');
    await db.query('UPDATE location_stocks SET opening_stock=0 WHERE item_id=$1',[items[1]]);
    await page.getByRole('button',{name:'Complete sale',exact:true}).click();await expect(page.getByRole('alert')).toContainText(/available/i);
    expect((await db.query('SELECT count(*)::int n FROM sales WHERE company_id=$1',[company])).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int n FROM stock_movements WHERE company_id=$1',[company])).rows[0].n).toBe(0);
    await db.query('UPDATE location_stocks SET opening_stock=10 WHERE item_id=$1',[items[1]]);
    await page.getByRole('button',{name:'Refresh stock and prices',exact:true}).click();await page.getByRole('button',{name:'Review sale',exact:true}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await testInfo.attach(`basket-${width}.png`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
    let key='';
    await page.route('**/inventory/sales/complete',async route=>{key=route.request().postDataJSON().idempotencyKey;const result=await route.fetch();expect(result.status()).toBe(201);await route.abort('connectionreset');});
    await page.getByRole('button',{name:'Complete sale',exact:true}).click();await expect(page.getByRole('heading',{name:'Confirm pending sale',exact:true})).toBeVisible();
    await page.reload();await page.getByRole('button',{name:'Check sale status',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Sale recorded'}).first()).toBeVisible();
    expect((await db.query('SELECT idempotency_key,total_cents FROM sales WHERE company_id=$1',[company])).rows).toEqual([{idempotency_key:key,total_cents:1150}]);
    expect((await db.query('SELECT count(*)::int n,sum(quantity)::int qty FROM stock_movements WHERE company_id=$1',[company])).rows[0]).toEqual({n:2,qty:5});
    await expect(page.getByRole('button',{name:'Retry same sale',exact:true})).toHaveCount(0);
  } finally {await db.end();}
});
