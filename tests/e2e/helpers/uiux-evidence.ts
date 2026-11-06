import { expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Optional audit artifacts; ordinary regression runs do not write outside test-results. */
export async function uiuxEvidence(page: Page, screen: string) {
  const directory = process.env.UIUX_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const preserveScroll = screen.startsWith('ux14');
  const popupOpen = await page.getByRole('dialog').count() > 0;
  await page.evaluate(async popup => { await document.fonts.ready; if (!popup) window.scrollTo(0, 0); }, popupOpen || preserveScroll);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const theme of ['violet', 'cobalt']) {
      await page.evaluate(value => { document.documentElement.dataset.accent = value; }, theme);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: join(directory, `${screen}-${page.viewportSize()!.width}-${theme}-${colorScheme}.png`), fullPage: !popupOpen && !preserveScroll, animations: 'disabled' });
    }
  }
}
