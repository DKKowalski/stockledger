import { expect, test, type Page } from '@playwright/test';
import { calendarMonth, clickDay, openCustom } from './helpers/calendar';

const companyId = '31000000-0000-4000-8000-000000000098';
const shopId = '32000000-0000-4000-8000-000000000098';
const summary = { netSalesCents: 0, discountsGivenCents: 0, fullPriceSalesCents: 0, costedRevenueCents: 0, cogsCents: 0, grossProfitCents: 0, marginPercent: null, inventoryLossCents: 0, costCoveragePercent: 100, unitsSold: 0, unitsReturned: 0 };

// A mocked session: the login endpoint is rate limited and the demo specs already use its allowance.
async function ownerAt(page: Page, path: string, timeZone = 'Africa/Accra') {
  await page.route('http://localhost:3100/**', route => route.fulfill({ json: [] }));
  await page.route('**/auth/refresh', route => route.fulfill({ json: { accessToken: 'test.session.token', user: { id: 'test-admin', companyId, fullName: 'Test admin', email: 'test@example.invalid', role: 'administrator', locationId: null, isActive: true, isDemo: false, setupPending: false } } }));
  await page.route('**/onboarding', route => route.fulfill({ json: { completed: true, company: { id: companyId, name: 'Test business', businessType: 'mixed', inventorySource: 'paper' }, counts: { locations: 1, items: 1, movements: 1, teammates: 1 } } }));
  await page.route('**/settings', route => route.fulfill({ json: { id: companyId, name: 'Test business', currency: 'GHS', timeZone, defaultUnit: 'pcs', defaultReorderLevel: 0, defaultLocationId: shopId, itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse' } }));
  await page.route('**/inventory/snapshot**', route => route.fulfill({ json: { items: [], locations: [{ id: shopId, name: 'Shop', type: 'shop' }], positions: [], movements: [], periodMovements: [], summary: { closingUnits: 0, stockValueCents: 0, lowStockItems: 0, damagedUnits: 0, deadStockLines: 0 } } }));
  await page.route('**/inventory/profitability**', route => route.fulfill({ json: { periodDays: 30, startDate: '2026-01-01', endDate: '2026-01-31', summary, lines: [], trend: [] } }));
  await page.route('**/inventory/movements?**', route => route.fulfill({ json: { movements: [], total: 0, offset: 0, limit: 50 } }));
  await page.goto(path);
}
for (const width of [1440, 390]) {
  test(`blocks a backwards range and applies across a month boundary at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ownerAt(page, '/profitability');
    await openCustom(page, 'Profit period');
    await clickDay(page, '2026-03-10');
    await clickDay(page, '2026-03-01');
    await expect(page.getByRole('alert').filter({ hasText: 'on or after the start date' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply dates' })).toBeDisabled();
    await clickDay(page, '2026-04-02');
    const request = page.waitForRequest(candidate => candidate.url().includes('/inventory/profitability') && candidate.url().includes('from=2026-03-10') && candidate.url().includes('to=2026-04-02'));
    await page.getByRole('button', { name: 'Apply dates' }).click();
    await request;
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('applies from the keyboard and returns to a preset', async ({ page }) => {
  await ownerAt(page, '/movements');
  await openCustom(page, 'Reporting period');
  await clickDay(page, '2026-01-01');
  await clickDay(page, '2026-01-31');
  const applied = page.waitForRequest(candidate => candidate.url().includes('/inventory/movements?') && candidate.url().includes('to=2026-01-31'));
  await page.getByRole('button', { name: 'Apply dates' }).focus();
  await page.keyboard.press('Enter');
  await applied;
  await page.getByRole('combobox', { name: 'Reporting period', exact: true }).first().click();
  const preset = page.waitForRequest(candidate => candidate.url().includes('/inventory/movements?') && !candidate.url().includes('2026-01-31'));
  await page.getByRole('option', { name: 'Last 30 days', exact: true }).click();
  await preset;
  await expect(page.locator('.date-range-fields')).toHaveCount(0);
});

test('the shared store range reaches every inventory page and the activity log', async ({ page }) => {
  await ownerAt(page, '/reports');
  await openCustom(page, 'Reporting period');
  await clickDay(page, '2026-02-01');
  await clickDay(page, '2026-02-02');
  const snapshot = page.waitForRequest(candidate => candidate.url().includes('/inventory/snapshot') && candidate.url().includes('from=2026-02-01'));
  await page.getByRole('button', { name: 'Apply dates' }).click();
  await snapshot;
  await page.evaluate(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByRole('button', { name: 'Reporting period: 1 Feb 2026 – 2 Feb 2026', exact: true })).toBeVisible();
  await page.evaluate(() => { window.history.pushState({}, '', '/settings/activity'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await openCustom(page, 'Reporting period');
  await clickDay(page, '2026-02-01');
  await clickDay(page, '2026-02-02');
  const activity = page.waitForRequest(candidate => candidate.url().includes('/settings/activity') && candidate.url().includes('to=2026-02-02'));
  await page.getByRole('button', { name: 'Apply dates' }).click();
  await activity;
});

test('keeps every preset from main and adds today, this month and last month in the company time zone', async ({ page }) => {
  // 12:00 UTC on 31 January is already 1 February in Auckland.
  await page.clock.setFixedTime(new Date('2026-01-31T12:00:00Z'));
  await ownerAt(page, '/profitability', 'Pacific/Auckland');
  await page.getByRole('combobox', { name: 'Profit period', exact: true }).click();
  await expect(page.getByRole('option')).toHaveText(['Today', 'Last 7 days', 'Last 30 days', 'Last 90 days', 'This month', 'Last month', 'Custom dates']);
  await page.keyboard.press('Escape');
  const pick = async (name: string, from: string, to: string) => {
    await page.getByRole('combobox', { name: 'Profit period', exact: true }).click();
    const request = page.waitForRequest(candidate => candidate.url().includes('/inventory/profitability') && candidate.url().includes(`from=${from}`) && candidate.url().includes(`to=${to}`));
    await page.getByRole('option', { name, exact: true }).click();
    await request;
    await expect(page.getByRole('combobox', { name: 'Profit period', exact: true })).toHaveText(name);
  };
  await pick('Today', '2026-02-01', '2026-02-01');
  await pick('Last month', '2026-01-01', '2026-01-31');
  await pick('This month', '2026-02-01', '2026-02-01');
  await expect(page.locator('.date-range-fields')).toHaveCount(0);
});

test('a named preset survives moving between pages that share the range', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-03-15T12:00:00Z'));
  await ownerAt(page, '/reports');
  await page.getByRole('combobox', { name: 'Reporting period', exact: true }).click();
  const snapshot = page.waitForRequest(candidate => candidate.url().includes('/inventory/snapshot') && candidate.url().includes('from=2026-02-01') && candidate.url().includes('to=2026-02-28'));
  await page.getByRole('option', { name: 'Last month', exact: true }).click();
  await snapshot;
  await page.evaluate(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByRole('combobox', { name: 'Reporting period', exact: true })).toHaveText('Last month');
});


test('keeps draft clicks out of requests, cancels them, and reopens the current range', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
  await ownerAt(page, '/profitability');
  const ranges: string[] = [];
  page.on('request', request => { if (request.url().includes('/inventory/profitability')) ranges.push(request.url()); });
  await openCustom(page, 'Profit period');
  await expect(page.getByRole('button', { name: /^Profit period:/ })).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('.calendar-range-summary')).toContainText('7 Oct 2026');
  const before = ranges.length;
  await clickDay(page, '2026-10-30');
  await expect(page.getByRole('button', { name: 'Apply dates' })).toBeDisabled();
  await clickDay(page, '2026-11-03');
  await expect(page.locator('.rdp-range_start:not(.rdp-hidden)[data-day="2026-10-30"]')).toHaveCount(1);
  await expect(page.locator('.rdp-range_middle:not(.rdp-hidden)[data-day="2026-10-31"]')).toHaveCount(1);
  expect(ranges).toHaveLength(before);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Profit period:/ })).toBeFocused();
  await page.getByRole('button', { name: /^Profit period:/ }).click();
  await expect(page.locator('.calendar-range-summary')).toContainText('7 Oct 2026');
  await clickDay(page, '2026-10-30');
  await clickDay(page, '2026-11-03');
  const applied = page.waitForRequest(request => request.url().includes('/inventory/profitability') && request.url().includes('from=2026-10-30') && request.url().includes('to=2026-11-03'));
  await page.getByRole('button', { name: 'Apply dates' }).click();
  await applied;
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /^Profit period:/ }).click();
  await expect(page.getByRole('button', { name: 'Apply dates' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Profit period:/ })).toBeFocused();
});

for (const timeZone of ['Pacific/Auckland', 'America/Los_Angeles']) {
  test.describe(`local calendar days in ${timeZone}`, () => {
    test.use({ timezoneId: timeZone });
    test('round trips days, uses company Today, and supports movement keyboard selection', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-01-31T12:00:00Z'));
      await ownerAt(page, '/movements', 'Pacific/Auckland');
      const trigger = page.getByRole('button', { name: 'Date: 1 Feb 2026', exact: true });
      await trigger.click();
      await expect(page.locator('.rdp-today')).toHaveAttribute('data-day', '2026-02-01');
      const day = page.locator('.rdp-day_button[tabindex="0"]');
      await expect(page.getByRole('dialog', { name: 'Choose date', exact: true })).toBeFocused();
      for (let tab = 0; tab < 5; tab++) await page.keyboard.press('Tab');
      await expect(day).toBeFocused();
      await day.press('ArrowRight');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'Date: 2 Feb 2026', exact: true })).toBeFocused();
      await expect(page.locator('.movement-form .date-validation-input')).toHaveValue('2026-02-02');
      await page.getByRole('button', { name: 'Date: 2 Feb 2026', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Choose date', exact: true })).toBeFocused();
      for (let tab = 0; tab < 5; tab++) await page.keyboard.press('Tab');
      await expect(page.locator('.rdp-day_button[tabindex="0"]')).toBeFocused();
      await page.keyboard.press('PageUp');
      await expect(page.locator('.rdp-month_grid')).toHaveAttribute('aria-label', 'January 2026');
      await page.keyboard.press('PageDown');
      await expect(page.locator('.rdp-month_grid')).toHaveAttribute('aria-label', 'February 2026');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Date: 2 Feb 2026', exact: true })).toBeFocused();
      const dates = await page.evaluate(async () => {
        const path = '/src/lib/calendar-date.ts';
        const { parseCalendarDate, calendarDateValue, formatCalendarDate } = await import(path);
        return ['2024-02-29', '2026-03-08', '2026-11-01'].map(value => [calendarDateValue(parseCalendarDate(value)), formatCalendarDate(value)]);
      });
      expect(dates).toEqual([['2024-02-29', '29 Feb 2024'], ['2026-03-08', '8 Mar 2026'], ['2026-11-01', '1 Nov 2026']]);
    });
  });
}

test('required empty dates block submission; optional dates clear, submit and respect limits', async ({ page }) => {
  await ownerAt(page, '/movements');
  // Mount the real reusable control with empty and optional props, which the current forms prefill.
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const source = await fetch('/src/components/ui/date-picker.tsx').then(response => response.text());
    const reactUrl = source.match(/from "(\/node_modules\/\.vite\/deps\/react\.js[^"]*)"/)![1]!;
    const { default: React } = await load(reactUrl);
    const mainSource = await fetch('/src/main.tsx').then(response => response.text());
    const clientUrl = mainSource.match(/from "(\/node_modules\/\.vite\/deps\/react-dom_client\.js[^"]*)"/)![1]!;
    const { default: { createRoot } } = await load(clientUrl);
    const { AuthContext } = await load('/src/auth-context.ts');
    const { CompanySettingsProvider } = await load('/src/app/company-settings-store.tsx');
    const { DatePicker } = await load('/src/components/ui/date-picker.tsx');
    const dialogSource = await fetch('/src/features/settings/security-settings-page.tsx').then(response => response.text());
    const dialogUrl = dialogSource.match(/from "(\/node_modules\/\.vite\/deps\/@base-ui_react_dialog\.js[^"]*)"/)![1]!;
    const { Dialog } = await load(dialogUrl);
    document.getElementById('root')!.style.display = 'none';
    const host = document.createElement('div');
    document.body.append(host);
    function Fixture() {
      const [date, setDate] = React.useState('');
      const [optional, setOptional] = React.useState('2026-11-06');
      const [saved, setSaved] = React.useState('');
      return React.createElement(React.Fragment, null, React.createElement('form', { onSubmit: (event: Event) => { event.preventDefault(); setSaved(JSON.stringify(Object.fromEntries(new FormData(event.target as HTMLFormElement)))); } },
        React.createElement(DatePicker, { label: 'Required day', name: 'day', value: date, required: true, onValueChange: setDate, min: '2026-11-01', max: '2026-11-10' }),
        React.createElement(DatePicker, { label: 'Optional day', name: 'optional', value: optional, onValueChange: setOptional }),
        React.createElement(DatePicker, { label: 'Disabled day', name: 'disabled', value: '', disabled: true, onValueChange: () => {} }),
        React.createElement('button', { type: 'submit' }, 'Submit fixture'), React.createElement('output', null, saved)),
      React.createElement(Dialog.Root, null,
        React.createElement(Dialog.Trigger, null, 'Open date dialog'),
        React.createElement(Dialog.Portal, null,
          React.createElement(Dialog.Backdrop, { className: 'team-share-backdrop' }),
          React.createElement(Dialog.Viewport, { className: 'team-share-viewport', style: { alignItems: 'end' } },
            React.createElement(Dialog.Popup, { className: 'team-share-dialog', style: { overflow: 'hidden', height: 220 } },
              React.createElement(Dialog.Title, null, 'Date dialog'),
              React.createElement('div', { style: { paddingTop: 80, overflow: 'hidden' } },
                React.createElement(DatePicker, { label: 'Dialog day', value: date, onValueChange: setDate })))))));
    }
    createRoot(host).render(React.createElement(AuthContext.Provider, { value: { accessToken: 'test', signOut: () => {} } }, React.createElement(CompanySettingsProvider, null, React.createElement(Fixture))));
  });
  await page.getByRole('button', { name: 'Submit fixture' }).click();
  await expect(page.getByRole('alert')).toHaveText('Choose required day.');
  await expect(page.getByRole('button', { name: /^Required day:/ })).toBeFocused();
  await expect(page.locator('output')).toBeEmpty();
  await expect(page.getByRole('button', { name: /^Required day:/ })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: /^Disabled day:/ })).toBeDisabled();
  await page.getByRole('button', { name: /^Required day:/ }).click();
  await calendarMonth(page, '2026-11-01');
  await expect(page.locator('.rdp-day[data-day="2026-11-11"] button')).toBeDisabled();
  await clickDay(page, '2026-11-06');
  await page.getByRole('button', { name: /^Optional day:/ }).click();
  await clickDay(page, '2026-11-06');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Optional day: 6 Nov 2026', exact: true })).toBeFocused();
  await page.getByRole('button', { name: /^Optional day:/ }).click();
  await page.getByRole('button', { name: 'Clear date' }).click();
  await expect(page.getByRole('button', { name: 'Optional day: Choose a date', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit fixture' }).click();
  await expect(page.locator('output')).toHaveText('{"day":"2026-11-06","optional":""}');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open date dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Date dialog', exact: true })).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: /^Dialog day:/ }).click();
  const popup = page.getByRole('dialog', { name: 'Choose dialog day', exact: true });
  await expect(popup).toBeVisible();
  const geometry = await popup.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { fits: box.x >= 0 && box.right <= innerWidth && box.y >= 0 && box.bottom <= innerHeight, onTop: element.contains(hit), pageFits: document.documentElement.scrollWidth <= innerWidth };
  });
  expect(geometry).toEqual({ fits: true, onTop: true, pageFits: true });
  await expect(page.locator('.rdp-day_button').first()).toHaveCSS('width', '40px');
  await expect(page.locator('.rdp-day_button').first()).toHaveCSS('height', '40px');
  await clickDay(page, '2026-11-07');
  await expect(page.getByRole('button', { name: 'Dialog day: 7 Nov 2026', exact: true })).toBeFocused();
  await page.getByRole('button', { name: /^Dialog day:/ }).click();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Date dialog', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Dialog day:/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open date dialog' })).toBeFocused();
});


test('submits the selected single date from the movement form', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
  await ownerAt(page, '/movements');
  await page.route('**/inventory/snapshot**', route => route.fulfill({ json: { items: [{ id: 'test-item', name: 'Calendar item', unit: 'pcs', unitCostCents: 100, sellingPriceCents: 200, isActive: true }], locations: [{ id: shopId, name: 'Shop', type: 'shop' }], positions: [], movements: [], periodMovements: [], summary: { closingUnits: 0, stockValueCents: 0, lowStockItems: 0, damagedUnits: 0, deadStockLines: 0 } } }));
  let movementDate = '';
  await page.route('**/inventory/movements', route => { movementDate = route.request().postDataJSON().movementDate; return route.fulfill({ status: 201, json: { id: 'test-movement' } }); });
  await page.reload();
  await page.getByRole('combobox', { name: 'Item', exact: true }).click();
  await page.getByRole('option', { name: 'Calendar item', exact: true }).click();
  await page.getByRole('combobox', { name: 'Place', exact: true }).click();
  await page.getByRole('option', { name: 'Shop', exact: true }).click();
  await page.getByLabel(/^Quantity received/).fill('2');
  await page.getByLabel(/Cost per .*\(GHS\)/).fill('1');
  await page.getByRole('button', { name: /^Date:/ }).click();
  await clickDay(page, '2026-10-31');
  await page.getByRole('button', { name: 'Save receipt', exact: true }).click();
  await expect.poll(() => movementDate).toBe('2026-10-31');
});
