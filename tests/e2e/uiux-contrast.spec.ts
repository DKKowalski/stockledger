import { expect, test, type Page } from '@playwright/test';
import { uiuxEvidence } from './helpers/uiux-evidence';

async function checkText(page: Page, selector: string, minimumSize = 12) {
  const measured = await page.locator(selector).evaluateAll(elements => {
    const rgba = (value: string) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (front: number[], back: number[]) => front.slice(0, 3).map((value, i) => value * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    const background = (element: Element): number[] => over(rgba(getComputedStyle(element).backgroundColor), element.parentElement ? background(element.parentElement) : [255, 255, 255]);
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    return elements.filter(element => element.getClientRects().length > 0).map(element => {
      const style = getComputedStyle(element), bg = background(element);
      const a = luminance(over(rgba(style.color), bg)), b = luminance(bg);
      return { text: element.textContent?.slice(0, 60), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), size: parseFloat(style.fontSize) };
    });
  });
  expect(measured.length).toBeGreaterThan(0);
  for (const sample of measured) {
    expect(sample.ratio, `${sample.text} contrast`).toBeGreaterThanOrEqual(4.5);
    expect(sample.size, `${sample.text} size`).toBeGreaterThanOrEqual(minimumSize);
  }
  return measured;
}

for (const width of [360, 390, 1440]) {
  test(`operational labels and focus pass contrast in both themes at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `198.51.100.${[360, 390, 1440].indexOf(width) + 40}` });
    await page.goto('/login');
    await page.getByRole('button', { name: 'Preview as owner' }).click();
    await expect(page).toHaveURL('/');
    const samples: Record<string, unknown> = {};
    for (const theme of ['violet', 'cobalt']) {
      await page.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
      await page.locator('.health-legend small').first().waitFor();
      await expect(page.locator('.today-money dd')).toHaveCount(2);
      await expect(page.locator('.today-money')).not.toContainText('could not load');
      await page.evaluate(async value => { document.documentElement.dataset.accent = value; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); }, theme);
      samples[`${theme}-health`] = await checkText(page, '.health-legend small, .chart-legend, .chart-period, .health-metric > span');
      // Use the shared focus treatment on an always-visible keyboard target.
      await page.keyboard.press('Tab');
      const target = page.locator('.notification-trigger:visible');
      await target.focus();
      const focus = await target.evaluate(element => {
        const style = getComputedStyle(element);
        const rgb = style.outlineColor.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const lum = (values: number[]) => values.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        return { width: parseFloat(style.outlineWidth), ratio: (1.05) / (lum(rgb) + .05) };
      });
      expect(focus.width).toBeGreaterThanOrEqual(3);
      expect(focus.ratio).toBeGreaterThanOrEqual(3);
      if (width !== 360) await uiuxEvidence(page, 'ux05-overview');
      for (const [route, selector] of [['/reports', width < 600 ? '.phone-stock-identity span' : 'thead th'], ['/team', 'thead th'], ['/profitability', '.profit-filter-grid label > span']] as const) {
        await page.evaluate(target => { history.pushState({}, '', target); dispatchEvent(new PopStateEvent('popstate')); }, route);
        await expect(page.getByRole('heading', { name: route === '/team' ? 'Team' : route === '/reports' ? 'Reports' : 'Profitability', exact: true })).toBeVisible();
        await page.locator(selector).first().waitFor();
        if (route === '/profitability') await page.locator('.profit-kpis').waitFor();
        await page.evaluate(value => { document.documentElement.dataset.accent = value; }, theme);
        samples[`${theme}${route}`] = await checkText(page, selector, route === '/profitability' ? 13 : 12);
        if (route === '/profitability') {
          samples[`${theme}-profit-controls`] = await checkText(page, '.profit-filter-grid .select-trigger, .profit-filter-grid .select-value, .profit-filter-grid .date-trigger', 13);
          const day = page.locator('.profit-chart-day').first();
          await day.focus();
          await expect(day).toBeFocused();
          await expect(day).toHaveAttribute('aria-label', /sales.*profit/i);
          await expect(day.getByRole('tooltip')).toHaveCSS('opacity', '1');
          samples[`${theme}-profit-tooltip`] = await checkText(page, '.profit-chart-day:first-child .profit-chart-tooltip b, .profit-chart-day:first-child .profit-chart-tooltip small');
          if (width === 1440) samples[`${theme}-profit-dates`] = await checkText(page, '.profit-chart-day > small');
          await page.screenshot({path:testInfo.outputPath(`profit-${width}-${theme}.png`),fullPage:true,animations:'disabled'});
          // Pointer users on a phone can reveal the same readable date and values.
          await day.click();
          await expect(day.getByRole('tooltip')).toHaveCSS('opacity', '1');
        }

        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width !== 360) await uiuxEvidence(page, `ux05-${route.slice(1)}`);
      }
    }
    await testInfo.attach('rendered-contrast.json', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
  });
}
