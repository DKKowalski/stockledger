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

export async function openCustom(page: Page, label: string) {
  await page.getByRole('combobox', { name: label, exact: true }).first().click();
  await page.getByRole('option', { name: 'Custom dates', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `${label} calendar`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
}
