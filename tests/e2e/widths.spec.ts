import { test, expect, type Page } from '@playwright/test';
import { ready, noHorizontalScroll } from './helpers';

// Layout matrix. Uses list mode (?nomap=1) so results don't depend on WebGL or map tiles.
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440, 1920];

async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight; };
    return [...document.querySelectorAll('button, input:not([type=checkbox]):not([type=range]), select, summary, .plist__item')]
      .filter((e) => vis(e) && !e.closest('.footer, .maplibregl-ctrl, .zhk-flag, .scene-help, .panel__handle, legend') && e.getBoundingClientRect().height < 44)
      .map((e) => `${(e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}`);
  });
}

test.describe('responsive layout matrix', () => {
  test.skip(({ isMobile }) => isMobile, 'viewport is set explicitly per case');

  for (const w of WIDTHS) {
    test(`${w}px: city list, project, apartment — no horizontal scroll, targets ≥44 px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: w < 768 ? 800 : 900 });
      await page.goto('/?nomap=1');
      await ready(page);
      await expect(page.locator('#disclaimer-top')).toBeVisible();
      await expect(page.locator('#appnav')).toBeVisible();
      await noHorizontalScroll(page);
      expect(await smallTargets(page)).toEqual([]);

      await page.locator('[data-list-slug="elaman"]').click();
      await expect(page.locator('#panel-body h2')).toHaveText('ЖК Elaman');
      const p = (await page.locator('#panel').boundingBox())!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(w + 1);
      await noHorizontalScroll(page);
      for (const c of await page.locator('.chess [data-apt]').all()) expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      await page.locator('.chess [data-apt]').first().click();
      await expect(page.locator('.apt h2')).toBeVisible();
      await page.locator('#mortgage').scrollIntoViewIfNeeded();
      await expect(page.locator('#mortgage .mort__res')).toBeVisible();
      await noHorizontalScroll(page);
      expect(await smallTargets(page)).toEqual([]);
    });
  }

  test('200 % zoom equivalent (720×450): usable, no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 450 });
    await page.goto('/?nomap=1&p=qadam');
    await expect(page.locator('#panel-body h2')).toHaveText('ЖК Qadam');
    await noHorizontalScroll(page);
    const title = (await page.locator('.brand__title').boundingBox())!;
    expect(title.width).toBeGreaterThan(120); // the title must not collapse into a column
    expect(await smallTargets(page)).toEqual([]);
  });

  test('reduced motion: no transitions on the sheet', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/?nomap=1&p=qadam');
    const d = await page.locator('#panel').evaluate((e) => getComputedStyle(e).transitionDuration);
    expect(d.split(',').every((x) => parseFloat(x) <= 0.001)).toBe(true);
  });
});
