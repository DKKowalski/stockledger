import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import * as argon2 from 'argon2';

// Automated WCAG 2 A/AA checks on the key phone screens. These catch missing
// names, labels, contrast and landmark problems; they do not replace a manual
// VoiceOver/TalkBack pass (focus order, announcements and wording need a human).
const url = process.env.INVENTORY_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) throw Error('Accessibility tests require the isolated local database');

const found: string[] = [];
async function scan(page: Page, screen: string) {
  await expect(page.locator('main')).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const summary = violations.map(v => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.slice(0, 4).map(n => `    ${n.target.join(' ')}`).join('\n')}`);
  found.push(...summary.map(line => `[${screen}] ${line}`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${screen} scrolls horizontally`).toBe(true);
}

test('key mobile screens have no WCAG A/AA axe violations', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '198.51.100.231' });
  const db = new pg.Client({ connectionString: url }); await db.connect();
  const company = randomUUID(), shop = randomUUID(), owner = randomUUID(), items = [randomUUID(), randomUUID()], password = randomUUID(), email = `${owner}@example.invalid`;
  try {
    await db.query("INSERT INTO companies(id,name,onboarding_completed_at,hybrid_pricing_enabled,updated_at) VALUES ($1,'Access shop',now(),true,now())", [company]);
    await db.query("INSERT INTO locations(id,company_id,name,type,updated_at) VALUES ($1,$2,'Access shop','shop',now())", [shop, company]);
    await db.query("INSERT INTO users(id,company_id,full_name,email,password_hash,role,email_verified_at,invitation_accepted_at,updated_at) VALUES ($1,$2,'Access owner',$3,$4,'administrator',now(),now(),now())", [owner, company, email, await argon2.hash(password)]);
    for (const [n, item] of items.entries()) {
      await db.query("INSERT INTO inventory_items(id,company_id,sku,name,category,unit,unit_cost_cents,selling_price_cents,updated_at) VALUES ($1,$2,$3,$4,'Test','tin',100,200,now())", [item, company, `A11Y-${n}`, ['Milo 400g Tin', 'Sugar 1kg Bag'][n]]);
      await db.query('INSERT INTO location_stocks(id,company_id,item_id,location_id,opening_stock,updated_at) VALUES ($1,$2,$3,$4,22,now())', [randomUUID(), company, item, shop]);
    }

    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await scan(page, 'login');

    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByPlaceholder('Enter your password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('main')).toBeVisible();
    await scan(page, 'stock overview');

    await page.goto('/sell');
    await page.getByRole('combobox', { name: 'Shop for this sale', exact: true }).click();
    await page.getByRole('option', { name: 'Access shop', exact: true }).click();
    for (const name of ['Milo 400g Tin', 'Sugar 1kg Bag']) {
      await page.getByRole('combobox', { name: 'Item', exact: true }).click();
      await page.getByRole('option', { name, exact: true }).click();
      await page.getByLabel('Quantity', { exact: true }).fill('10');
      await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: /Remove Milo 400g Tin/ })).toBeVisible();
    await page.locator('.checkout-basket').screenshot({ path: testInfo.outputPath('basket-line-375.png') });
    await scan(page, 'checkout basket');

    await page.getByRole('button', { name: 'Review sale', exact: true }).click();
    await expect(page.locator('.checkout-pay dd')).toContainText('40.00');
    await page.locator('.checkout-basket').screenshot({ path: testInfo.outputPath('basket-line-quoted-375.png') });
    await scan(page, 'checkout review');
    await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
    await page.getByRole('link', { name: 'View customer receipt', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Customer receipt', exact: true })).toBeVisible();
    await scan(page, 'receipt');

    await page.goto('/movements');
    await expect(page.locator('.customer-returns-panel')).toBeVisible();
    await scan(page, 'return panel');

    await page.goto('/finance');
    await expect(page.getByRole('heading', { name: /Finance/ }).first()).toBeVisible();
    await scan(page, 'finance');

    // Other revenue early this month gives the month a profit, so the profit split (an estimate) shows.
    await db.query("INSERT INTO finance_entries(id,company_id,kind,entry_date,amount_cents,note,created_by_user_id,updated_at) VALUES ($1,$2,'other_revenue',date_trunc('month', now() at time zone 'utc')::date,123457,'Access fixture',$3,now())", [randomUUID(), company, owner]);
    await page.reload();
    await expect(page.locator('.profit-split-card').first()).toBeVisible();
    await scan(page, 'finance profit split');
    expect(found, 'axe violations (wcag2a, wcag2aa)').toEqual([]);
  } finally { await db.end(); }
});
