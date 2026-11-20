import { expect, type Page, type ConsoleMessage } from '@playwright/test';

/** Collects console errors and uncaught exceptions; ignores tile/network noise from the map CDN. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  const ignore = /tiles\.openfreemap\.org|Failed to load resource|net::ERR|WebGL|GPU stall|ResizeObserver/i;
  page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error' && !ignore.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

export async function ready(page: Page) {
  await expect(page.locator('#project-list .plist__item').first()).toBeVisible();
}

/** True when the MapLibre style loaded (WebGL + network to tiles). Map-dependent tests skip otherwise. */
export async function mapReady(page: Page, timeout = 15_000) {
  try {
    await page.waitForFunction(() => !!document.querySelector('#map canvas') && document.querySelectorAll('.zhk-flag').length > 0, null, { timeout });
    return true;
  } catch {
    return false;
  }
}

export const search = (page: Page) => new URL(page.url()).searchParams;

/** Clears persisted favourites/compare before a test. */
export async function freshStorage(page: Page) {
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('__e2e')) { localStorage.clear(); sessionStorage.setItem('__e2e', '1'); } } catch { /* ignore */ } });
}

export async function noHorizontalScroll(page: Page) {
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, 'document must not scroll horizontally').toBeLessThanOrEqual(w);
}
