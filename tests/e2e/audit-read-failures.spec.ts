import { expect, test } from '@playwright/test';
import { mediumSession } from './helpers/medium-session';

for (const width of [390, 1440]) {
  test(`settings failure blocks currency-sensitive content and retries (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mediumSession(page);
    let failed = true;
    await page.route('**/inventory/profitability?**', route => route.fulfill({ json: { startDate: '2026-11-01', endDate: '2026-11-06', lines: [], trend: [], summary: { netSalesCents: 123456, grossProfitCents: 0, cogsCents: 0, costCoveragePercent: 100, marginPercent: null, unitsSold: 1, unitsReturned: 0, costedRevenueCents: 123456, inventoryLossCents: 0 } } }));
    await page.route('**/settings', route => failed ? route.fulfill({ status: 503, json: { message: 'Unavailable' } }) : route.fulfill({ json: { currency: 'USD', timeZone: 'America/New_York', itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse' } }));
    await page.goto('/profitability');
    await expect(page.getByRole('alert')).toContainText('Business settings');
    await expect(page.getByText('Net sales', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`settings-${width}.png`), fullPage: true });
    failed = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Profitability', exact: true })).toBeVisible();
    await expect(page.getByText('$1,234.56', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('GH₵1,234.56', { exact: true })).toHaveCount(0);
  });

  test(`failed profitability filter never displays another shop's figures (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mediumSession(page);
    let failed = false;
    await page.route('**/inventory/profitability?**', route => failed ? route.fulfill({ status: 503, json: { message: 'Unavailable' } }) : route.fulfill({ json: { startDate: '2026-11-01', endDate: '2026-11-06', lines: [], trend: [], summary: { netSalesCents: 123456, cogsCents: 100, grossProfitCents: 123356, costCoveragePercent: 100, unitsSold: 1, unitsReturned: 0, costedRevenueCents: 123456, marginPercent: 99, inventoryLossCents: 0 } } }));
    await page.goto('/profitability');
    await expect(page.getByText('GH₵1,234.56', { exact: true }).first()).toBeVisible();
    failed = true;
    await page.getByRole('combobox', { name: 'Place', exact: true }).click();
    await page.getByRole('option', { name: 'Main shop', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('GH₵1,234.56', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`profit-${width}.png`), fullPage: true });
    failed = false;
    await page.getByRole('button', { name: 'Retry report', exact: true }).click();
    await expect(page.getByText('GH₵1,234.56', { exact: true }).first()).toBeVisible();
  });

  test(`count history failure retries without losing a count draft (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mediumSession(page);
    let failed = true;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/inventory/stock-counts', route => failed ? route.fulfill({ status: 503, json: { message: 'Unavailable' } }) : route.fulfill({ json: [] }));
    await page.goto('/stock-counts');
    await page.getByLabel('Reason or note', { exact: true }).fill('Keep this count draft');
    await expect(page.getByRole('alert')).toContainText('Count history could not load');
    await expect(page.getByText('Loading count history', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`counts-${width}.png`), fullPage: true });
    failed = false;
    await page.getByRole('button', { name: 'Retry count history', exact: true }).click();
    await expect(page.getByText('No stock counts yet.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Reason or note', { exact: true })).toHaveValue('Keep this count draft');
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
