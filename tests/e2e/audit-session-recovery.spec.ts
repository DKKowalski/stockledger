import { expect, test } from '@playwright/test';
import { mediumSession } from './helpers/medium-session';

for (const width of [390, 1440]) {
  test(`startup outage preserves the requested route and recovers on retry (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mediumSession(page, false, 'shop_attendant');
    let failed = true, requests = 0;
    await page.route('**/auth/refresh', async route => {
      requests++;
      return failed ? route.fulfill({ status: 503, json: { message: 'Unavailable' } }) : route.fulfill({ json: { accessToken: 'recovered-session', user: { id: 'attendant', companyId: 'company', role: 'shop_attendant', fullName: 'Staff', locationId: 'shop', isActive: true } } });
    });
    await page.route('**/inventory/sale-completion', route => route.fulfill({ json: { available: false } }));
    await page.goto('/sell');
    await expect(page.getByRole('alert')).toContainText('could not restore');
    await expect(page).toHaveURL('/sell');
    await page.screenshot({ path: test.info().outputPath(`session-${width}.png`), fullPage: true });
    expect(requests).toBe(1);
    failed = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sell', exact: true })).toBeVisible();
    expect(requests).toBe(2);
  });
}

test('two tabs serialize real rotating-cookie recovery and stay signed in', async ({ context }) => {
  let cookieVersion = 0, inFlight = 0, maximum = 0;
  await context.route('**/auth/refresh', async route => {
    inFlight++; maximum = Math.max(maximum, inFlight);
    const cookie = route.request().headers().cookie ?? '';
    if (cookieVersion && !cookie.includes(`rotation=${cookieVersion}`)) {
      inFlight--; return route.fulfill({ status: 401, json: { message: 'Expired rotation' } });
    }
    // A delayed response lets the other tab contend for the browser's session lock.
    await new Promise(resolve => setTimeout(resolve, 100));
    cookieVersion++;
    await route.fulfill({ headers: { 'Set-Cookie': `rotation=${cookieVersion}; Path=/; HttpOnly; SameSite=Lax` }, json: { accessToken: `tab-session-${cookieVersion}`, user: { id: 'attendant', companyId: 'company', role: 'shop_attendant', fullName: 'Staff', locationId: 'shop', isActive: true } } });
    inFlight--;
  });
  const a = await context.newPage(), b = await context.newPage();
  for (const page of [a, b]) {
    await mediumSession(page, false, 'shop_attendant');
    await page.unroute('**/auth/refresh');
    await page.unroute('http://localhost:3100/**');
    await page.route('**/inventory/sale-completion', route => route.fulfill({ json: { available: false } }));
  }
  await Promise.all([a.goto('/sell'), b.goto('/sell')]);
  await expect(a.getByRole('heading', { name: 'Sell', exact: true })).toBeVisible();
  await expect(b.getByRole('heading', { name: 'Sell', exact: true })).toBeVisible();
  expect(maximum).toBe(1); expect(cookieVersion).toBe(2);
});
