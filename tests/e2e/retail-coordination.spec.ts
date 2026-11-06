import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import * as argon2 from 'argon2';

const url = process.env.INVENTORY_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) {
  throw new Error('Retail coordination e2e requires a uniquely named local test database');
}

for (const first of ['concurrent', 0, 1] as const) {
  test(`retail tabs record one sale and both settle (first queued: ${first})`, async ({ context }, testInfo) => {
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    const company = randomUUID(), shop = randomUUID(), user = randomUUID(), item = randomUUID();
    const email = `${user}@example.invalid`, password = randomUUID();
    const lockName = `stockledger:retail-sale:${company}:${user}:${shop}`;
    const pages = [await context.newPage(), await context.newPage()];
    const writes: { tab: number; key: string }[] = [];
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
    const state = async () => (await db.query(`
      SELECT (SELECT count(*)::int FROM stock_movements WHERE company_id=$1 AND type='sale') AS sales,
        (SELECT coalesce(sum(quantity),0)::int FROM stock_movements WHERE company_id=$1 AND type='sale') AS deducted,
        (SELECT opening_stock FROM location_stocks WHERE company_id=$1) -
          (SELECT coalesce(sum(quantity),0)::int FROM stock_movements WHERE company_id=$1 AND type='sale') AS closing,
        (SELECT count(*)::int FROM retail_sale_requests WHERE company_id=$1) AS receipts
    `, [company])).rows[0];
    try {
      await db.query("INSERT INTO companies(id,name,onboarding_completed_at,updated_at) VALUES ($1,'Coordination test',now(),now())", [company]);
      await db.query("INSERT INTO locations(id,company_id,name,type,updated_at) VALUES ($1,$2,'Coordination shop','shop',now())", [shop, company]);
      await db.query("INSERT INTO users(id,company_id,location_id,full_name,email,password_hash,role,email_verified_at,invitation_accepted_at,updated_at) VALUES ($1,$2,$3,'Coordination attendant',$4,$5,'shop_attendant',now(),now(),now())", [user, company, shop, email, await argon2.hash(password)]);
      await db.query("INSERT INTO inventory_items(id,company_id,sku,name,category,unit,unit_cost_cents,selling_price_cents,updated_at) VALUES ($1,$2,'COORDINATION','Coordination product','Test','pcs',100,175,now())", [item, company]);
      await db.query('INSERT INTO location_stocks(id,company_id,item_id,location_id,opening_stock,updated_at) VALUES ($1,$2,$3,$4,30,now())', [randomUUID(), company, item, shop]);
      // Independent synthetic visitors must not share the local login throttle bucket.
      const ip = [...Buffer.from(randomUUID().replaceAll('-', '').slice(0, 6), 'hex')];
      await context.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.${ip.join('.')}` });
      const login = await context.request.post('http://localhost:3100/auth/login', { data: { email, password } });
      expect(login.status()).toBe(200);
      for (const page of pages) {
        await page.goto('/sell');
        await page.getByRole('combobox', { name: 'Item', exact: true }).click();
        await page.getByRole('option', { name: 'Coordination product', exact: true }).click();
        await page.getByLabel('Quantity', { exact: true }).fill('15');
      }
      expect(await state()).toEqual({ sales: 0, deducted: 0, closing: 30, receipts: 0 });
      await pages[0]!.evaluate(name => new Promise<void>(acquired => {
        void navigator.locks.request(name, async () => {
          acquired();
          await new Promise<void>(release => { (window as unknown as { releaseRetailLock: () => void }).releaseRetailLock = release; });
        });
      }), lockName);
      await context.route('**/inventory/movements', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        writes.push({ tab: pages.indexOf(route.request().frame().page()), key: route.request().postDataJSON().idempotencyKey });
        // Commit through the actual API, then hold its acknowledgement while another tab waits.
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await responseGate;
        await route.fulfill({ response });
      });
      const queued = async () => (await pages[0]!.evaluate(() => navigator.locks.query())).pending?.filter(lock => lock.name === lockName).length;
      const submit = (index: number) => pages[index]!.getByRole('button', { name: 'Sell', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
      if (first === 'concurrent') await Promise.all(pages.map((_, index) => submit(index)));
      else {
        await submit(first);
        await expect.poll(queued).toBe(1);
        await submit(1 - first);
      }
      await expect.poll(queued).toBe(2);
      await pages[0]!.evaluate(() => (window as unknown as { releaseRetailLock: () => void }).releaseRetailLock());
      try {
        await expect.poll(() => writes.length).toBe(1);
        await expect.poll(state).toEqual({ sales: 1, deducted: 15, closing: 15, receipts: 1 });
        await expect.poll(queued).toBe(1);
      } finally { releaseResponse(); }
      expect(writes).toHaveLength(1);
      const winner = pages[writes[0]!.tab]!;
      const loser = pages[1 - writes[0]!.tab]!;
      if (first !== 'concurrent') expect(writes[0]!.tab).toBe(first);
      await expect(winner.getByRole('status').filter({ hasText: 'Sale recorded once' })).toBeVisible();
      await expect(winner.getByLabel('Quantity', { exact: true })).toHaveValue('');
      await expect(loser.getByRole('alert')).toHaveText('Another tab recorded a sale. Reload and review your entries before starting the next sale.');
      await expect(loser.getByRole('button', { name: 'Sell', exact: true })).toBeDisabled();
      await expect(loser.getByRole('button', { name: 'Review entries', exact: true })).toBeEnabled();
      for (const page of pages) {
        await expect(page.getByRole('button', { name: /Recording|Retry same sale/ })).toHaveCount(0);
        await expect(page.getByRole('status').filter({ hasText: 'The last sale needs confirmation' })).toHaveCount(0);
        expect(await page.evaluate(key => localStorage.getItem(key), lockName)).toBeNull();
      }
      await expect.poll(queued).toBe(0);
      expect(writes).toHaveLength(1);
      await expect.poll(async () => (await winner.evaluate(() => navigator.locks.query())).held?.filter(lock => lock.name === lockName).length).toBe(0);
      const singleSale = await state();
      expect(singleSale).toEqual({ sales: 1, deducted: 15, closing: 15, receipts: 1 });
      expect((await db.query('SELECT idempotency_key FROM retail_sale_requests WHERE company_id=$1', [company])).rows).toEqual([{ idempotency_key: writes[0]!.key }]);
      await testInfo.attach('single-sale-database', { body: JSON.stringify(singleSale), contentType: 'application/json' });

      // The winning tab can start a distinct sale after acknowledgement clears the slot.
      await winner.getByRole('combobox', { name: 'Item', exact: true }).click();
      await winner.getByRole('option', { name: 'Coordination product', exact: true }).click();
      await expect(winner.getByText('15 pcs available at Coordination shop', { exact: true })).toBeVisible();
      await winner.getByLabel('Quantity', { exact: true }).fill('2');
      await winner.getByRole('button', { name: 'Sell', exact: true }).click();
      await expect.poll(() => writes.length).toBe(2);
      expect(writes[1]!.key).not.toBe(writes[0]!.key);
      await expect(winner.getByRole('status').filter({ hasText: 'Sale recorded once' })).toBeVisible();
      await expect.poll(state).toEqual({ sales: 2, deducted: 17, closing: 13, receipts: 2 });
    } finally {
      releaseResponse();
      try {
        // Capture persistence and both tab states before deleting the synthetic tenant,
        // including when a UI assertion fails.
        const evidence = {
          writes, database: await state(),
          tabs: await Promise.all(pages.map(async (page, tab) => ({
            tab, statuses: await page.getByRole('status').allTextContents(),
            alerts: await page.getByRole('alert').allTextContents(),
            locks: await page.evaluate(() => navigator.locks.query()),
            pending: await page.evaluate(key => localStorage.getItem(key) !== null, lockName),
          }))),
        };
        await testInfo.attach('retail-coordination', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
      } finally {
        try {
          await context.close();
          // Only this test's synthetic tenant, inside the guarded disposable database.
          for (const table of ['retail_sale_requests', 'stock_movements', 'location_stocks', 'refresh_sessions', 'audit_events', 'inventory_items', 'users', 'locations']) {
            await db.query(`DELETE FROM ${table} WHERE company_id=$1`, [company]);
          }
          await db.query('DELETE FROM companies WHERE id=$1', [company]);
        } finally { await db.end(); }
      }
    }
  });
}
