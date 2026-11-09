import { expect, type Page } from '@playwright/test';

export async function calendarMonth(page: Page, date: string) {
  const [year, month] = date.split('-');
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(new Date(2026, Number(month) - 1, 1));
  await page.getByRole('combobox', { name: 'Choose the Year' }).first().click();
  await page.getByRole('option', { name: year, exact: true }).click();
  await page.getByRole('combobox', { name: 'Choose the Month' }).first().click();
  await page.getByRole('option', { name: monthName, exact: true }).click();
}

export async function clickDay(page: Page, date: string) {
  const day = page.locator(`.rdp-day[data-day="${date}"] button`).first();
  if (!await day.isVisible()) await calendarMonth(page, date);
  await page.locator(`.rdp-day[data-day="${date}"] button`).first().click();
}

// A freshly loaded page keeps shifting for a moment. Playwright answers a moving target by retrying the click with a
// different scroll alignment, which scrolls the page on a slow runner, so wait until the target has stopped moving.
async function settle(page: Page, label: string) {
  const trigger = page.getByRole('combobox', { name: label, exact: true }).first();
  await trigger.waitFor();
  await trigger.evaluate(element => new Promise<void>(resolve => {
    let last = '';
    let still = 0;
    const check = () => {
      const box = element.getBoundingClientRect();
      const now = `${box.top}|${box.left}|${document.documentElement.scrollHeight}`;
      still = now === last ? still + 1 : 0;
      last = now;
      if (still >= 15) resolve(); else requestAnimationFrame(check);
    };
    check();
  }));
}

export async function openCustom(page: Page, label: string) {
  await settle(page, label);
  await page.getByRole('combobox', { name: label, exact: true }).first().click();
  await page.getByRole('option', { name: 'Custom dates', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `${label} calendar`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
}
