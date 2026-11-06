import { expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Optional audit artifacts; ordinary regression runs do not write outside test-results. */
export async function uiuxEvidence(page: Page, screen: string) {
  const directory = process.env.UIUX_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
  for (const theme of ['violet', 'cobalt']) {
    await page.evaluate(value => { document.documentElement.dataset.accent = value; }, theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(directory, `${screen}-${page.viewportSize()!.width}-${theme}.png`), fullPage: await page.getByRole('dialog').count() === 0, animations: 'disabled' });
  }
}
