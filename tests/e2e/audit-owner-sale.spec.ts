import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import * as argon2 from 'argon2';
const url = process.env.INVENTORY_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) throw new Error('Use isolated local test database');
for (const width of [390, 1440]) {
  test(`owner records retail and quoted sales at the chosen shop (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const db = new pg.Client({ connectionString: url }); await db.connect();
    const company = randomUUID(), owner = randomUUID(), shop = randomUUID(), other = randomUUID(), item = randomUUID();
    const email = `${owner}@test.invalid`, password = randomUUID();
    try {
      await db.query("INSERT INTO companies(id,name,onboarding_completed_at,updated_at) VALUES ($1,'Owner sale test',now(),now())", [company]);
      await db.query("INSERT INTO locations(id,company_id,name,type,updated_at) VALUES ($1,$3,'First shop','shop',now()),($2,$3,'Second shop','shop',now())", [other, shop, company]);
      await db.query("INSERT INTO users(id,company_id,full_name,email,password_hash,role,email_verified_at,updated_at) VALUES ($1,$2,'Owner',$3,$4,'administrator',now(),now())", [owner, company, email, await argon2.hash(password)]);
      await db.query("INSERT INTO inventory_items(id,company_id,sku,name,category,unit,unit_cost_cents,selling_price_cents,updated_at) VALUES ($1,$2,'OWNER','Owner product','Test','pcs',100,175,now())", [item, company]);
      for (const [place, qty] of [[other, 1], [shop, 20]]) await db.query('INSERT INTO location_stocks(id,company_id,item_id,location_id,opening_stock,updated_at) VALUES ($1,$2,$3,$4,$5,now())', [randomUUID(), company, item, place, qty]);
      await page.goto('/login');
      await page.getByLabel('Email address', { exact: true }).fill(email);
      await page.getByPlaceholder('Enter your password').fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      if (width === 390) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Sell', exact: true }).click();
      await page.getByRole('combobox', { name: 'Shop for this sale', exact: true }).click();
      await page.getByRole('option', { name: 'Second shop', exact: true }).click();
      const choose = async () => {
        await page.getByRole('combobox', { name: 'Item', exact: true }).click();
        await page.getByRole('option', { name: 'Owner product', exact: true }).click();
        await page.getByLabel('Quantity', { exact: true }).fill('2');
      };
      await choose();
      await expect(page.getByText('20 pcs available at Second shop', { exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`owner-retail-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Sell', exact: true }).click();
      await expect.poll(async () => Number((await db.query('SELECT sum(quantity) n FROM stock_movements WHERE company_id=$1 AND location_id=$2', [company, shop])).rows[0].n)).toBe(2);
      await db.query('UPDATE companies SET hybrid_pricing_enabled=true WHERE id=$1', [company]);
      await page.reload();
      await choose();
      await page.getByRole('button', { name: 'Review sale', exact: true }).click();
      await expect(page.getByText('Customer pays', { exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`owner-quote-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Sale recorded' }).first()).toBeVisible();
      const saved = (await db.query('SELECT created_by_user_id,location_id,total_cents FROM sales WHERE company_id=$1', [company])).rows;
      expect(saved).toEqual([{ created_by_user_id: owner, location_id: shop, total_cents: 350 }]);
      expect(Number((await db.query('SELECT count(*) n FROM stock_movements WHERE company_id=$1 AND location_id=$2', [company, other])).rows[0].n)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await db.end(); }
  });
}
