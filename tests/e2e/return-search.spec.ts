import {randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import pg from 'pg';
import * as argon2 from 'argon2';
const url=process.env.INVENTORY_TEST_DATABASE_URL;
if(!url || new URL(url).hostname!=='127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) throw Error('Return search requires the isolated local database');
for(const width of [390,1440]) test(`both return selectors find an older sale beyond the recent cap at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:1000});await page.setExtraHTTPHeaders({'X-Forwarded-For':width===390?'198.51.100.221':'198.51.100.222'});
  const db=new pg.Client({connectionString:url});await db.connect();
  const company=randomUUID(),shop=randomUUID(),user=randomUUID(),item=randomUUID(),password=randomUUID(),email=`${user}@example.invalid`;
  try {
    await db.query("INSERT INTO companies(id,name,onboarding_completed_at,hybrid_pricing_enabled,updated_at) VALUES ($1,'Return search',now(),true,now())",[company]);
    await db.query("INSERT INTO locations(id,company_id,name,type,updated_at) VALUES ($1,$2,'Return shop','shop',now())",[shop,company]);
    await db.query("INSERT INTO users(id,company_id,full_name,email,password_hash,role,email_verified_at,invitation_accepted_at,updated_at) VALUES ($1,$2,'Return owner',$3,$4,'administrator',now(),now(),now())",[user,company,email,await argon2.hash(password)]);
    await db.query("INSERT INTO inventory_items(id,company_id,sku,name,category,unit,unit_cost_cents,selling_price_cents,updated_at) VALUES ($1,$2,'RETURN','Return item','Test','pcs',100,200,now())",[item,company]);
    await db.query('INSERT INTO location_stocks(id,company_id,item_id,location_id,opening_stock,updated_at) VALUES ($1,$2,$3,$4,1000,now())',[randomUUID(),company,item,shop]);
    await db.query("INSERT INTO stock_movements(id,company_id,item_id,location_id,type,quantity,unit_price_cents,unit_cost_cents,movement_date,reference,created_at) SELECT gen_random_uuid(),$1,$2,$3,'sale',2,200,100,CASE WHEN n=0 THEN '2025-01-01'::date ELSE current_date END,'Return receipt '||n,now()-((205-n)||' seconds')::interval FROM generate_series(0,204) n",[company,item,shop]);
    const original=(await db.query("SELECT id FROM stock_movements WHERE company_id=$1 AND reference='Return receipt 0'",[company])).rows[0].id;
    await page.goto('/login');await page.getByLabel('Email address',{exact:true}).fill(email);await page.getByPlaceholder('Enter your password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL('/');
    await page.evaluate(()=>{history.pushState({},'','/movements');dispatchEvent(new PopStateEvent('popstate'));});
    await expect(page.getByRole('heading',{name:'Stock movements',exact:true})).toBeVisible();
    const returns=page.locator('.customer-returns-panel');
    await returns.getByLabel('Find sale by reference, full ID or item name',{exact:true}).fill('Return receipt 0');
    await returns.getByRole('combobox',{name:'Return original sale',exact:true}).click();
    await page.getByRole('option',{name:'Return receipt 0 · 2025-01-01',exact:true}).click();
    await expect(returns).toContainText('Return item');await expect(returns).toContainText('2');
    const legacy=page.locator('.movement-form');
    await legacy.getByRole('combobox',{name:'Movement type',exact:true}).click();await page.getByRole('option',{name:'Customer return',exact:true}).click();
    await legacy.getByLabel('Find sale by reference, full ID or item name',{exact:true}).fill(original);
    await legacy.getByRole('combobox',{name:'Original sale',exact:true}).click();
    await page.getByRole('option',{name:'Return item · 2 returnable · 2025-01-01',exact:true}).click();
    await expect(legacy.getByLabel('Quantity',{exact:true})).toHaveAttribute('max','2');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await legacy.screenshot({path:testInfo.outputPath(`legacy-return-${width}.png`)});
    await returns.screenshot({path:testInfo.outputPath(`grouped-return-${width}.png`)});
    await testInfo.attach(`returns-${width}.png`,{body:await page.screenshot({path:testInfo.outputPath(`returns-${width}.png`),fullPage:true}),contentType:'image/png'});
  } finally {await db.end();}
});
