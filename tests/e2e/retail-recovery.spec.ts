import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import * as argon2 from 'argon2';

// This regression requires the isolated local database used by the real API.
const url = process.env.INVENTORY_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) {
  throw new Error('Retail recovery e2e requires a uniquely named local test database');
}

test('retail sale recovers a committed lost response after reload and a new sale gets a new key', async ({ page }) => {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const company = randomUUID(), shop = randomUUID(), user = randomUUID(), item = randomUUID();
  const email = `${user}@example.invalid`, password = randomUUID();
  try {
    await db.query("INSERT INTO companies(id,name,onboarding_completed_at,updated_at) VALUES ($1,'Recovery test',now(),now())", [company]);
    await db.query("INSERT INTO locations(id,company_id,name,type,updated_at) VALUES ($1,$2,'Recovery shop','shop',now())", [shop, company]);
    await db.query("INSERT INTO users(id,company_id,location_id,full_name,email,password_hash,role,email_verified_at,invitation_accepted_at,updated_at) VALUES ($1,$2,$3,'Recovery attendant',$4,$5,'shop_attendant',now(),now(),now())", [user, company, shop, email, await argon2.hash(password)]);
    await db.query("INSERT INTO inventory_items(id,company_id,sku,name,category,unit,unit_cost_cents,selling_price_cents,updated_at) VALUES ($1,$2,'RECOVERY','Recovery product','Test','pcs',100,175,now())", [item, company]);
    await db.query('INSERT INTO location_stocks(id,company_id,item_id,location_id,opening_stock,updated_at) VALUES ($1,$2,$3,$4,20,now())', [randomUUID(), company, item, shop]);
    await page.goto('/login');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByPlaceholder('Enter your password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/');
    await page.getByRole('link', { name: 'Sell', exact: true }).click();
    const choose = async () => {
      await page.getByRole('combobox', { name: 'Item', exact: true }).click();
      await page.getByRole('option', { name: 'Recovery product', exact: true }).click();
      await page.getByLabel('Quantity', { exact: true }).fill('2');
    };
    await choose();
    const keys: string[] = [];
    await page.route('**/inventory/movements', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      keys.push(route.request().postDataJSON().idempotencyKey);
      if (keys.length === 1) {
        const result = await route.fetch();
        expect(result.status()).toBe(201);
        await route.abort('connectionreset');
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Sell', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('could not confirm');
    await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
    await page.reload();
    await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
    await page.getByRole('button', { name: 'Retry same sale', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Sale recorded' }).first()).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[a-f0-9-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    const sold = () => db.query('SELECT count(*)::int AS n, sum(quantity)::int AS qty FROM stock_movements WHERE company_id=$1 AND type=\'sale\'', [company]);
    expect((await sold()).rows[0]).toEqual({ n: 1, qty: 2 });
    await choose();
    await page.getByRole('button', { name: 'Sell', exact: true }).click();
    await expect.poll(async () => (await sold()).rows[0].n).toBe(2);
    expect(keys[2]).not.toBe(keys[0]);
    expect((await sold()).rows[0]).toEqual({ n: 2, qty: 4 });
  } finally {
    // Only this synthetic company's rows, in this disposable database.
    for (const table of ['retail_sale_requests', 'stock_movements', 'location_stocks', 'refresh_sessions', 'audit_events', 'inventory_items', 'users', 'locations']) {
      const exists = await db.query('SELECT to_regclass($1) AS name', [table]);
      if (exists.rows[0].name) await db.query(`DELETE FROM ${table} WHERE company_id=$1`, [company]);
    }
    await db.query('DELETE FROM companies WHERE id=$1', [company]);
    await db.end();
  }
});
