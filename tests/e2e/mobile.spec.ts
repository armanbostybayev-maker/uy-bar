import { test, expect, type Page } from '@playwright/test';
import { mapReady, search } from './helpers';

test.skip(({ isMobile }) => !isMobile, 'mobile-only behaviour');

const panel = (page: Page) => page.locator('#panel');
const snap = (page: Page) => panel(page).getAttribute('data-snap');
const avail = (page: Page) => page.evaluate(() => window.innerHeight - document.getElementById('appnav')!.getBoundingClientRect().height);
const height = async (page: Page) => (await panel(page).boundingBox())!.height;

async function expectSnap(page: Page, s: 'peek' | 'half' | 'full', pct: number) {
  await expect(panel(page)).toHaveAttribute('data-snap', s);
  await page.waitForTimeout(400); // height transition
  const ratio = (await height(page)) / (await avail(page));
  expect(Math.abs(ratio - pct / 100)).toBeLessThan(0.02);
}
/** Drag the sheet handle with real in-page PointerEvents so the timing is realistic
 *  (Playwright's mouse.move round-trips are ~200 ms each here, which would turn every flick into a slow drag). */
async function dragHandle(page: Page, dy: number, ms: number) {
  await page.evaluate(async ({ dy, ms }) => {
    const h = document.getElementById('panel-handle')!;
    const r = h.getBoundingClientRect();
    const x = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const fire = (type: string, y: number) => h.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
    const steps = Math.max(3, Math.round(ms / 16));
    fire('pointerdown', y0);
    for (let i = 1; i <= steps; i++) { await new Promise((res) => setTimeout(res, ms / steps)); fire('pointermove', y0 + (dy * i) / steps); }
    fire('pointerup', y0 + dy);
  }, { dy, ms });
}

test('bottom navigation has the four sections (Карта hidden when 3D is unavailable)', async ({ page }) => {
  await page.goto('/');
  const items = page.locator('#appnav .appnav__b:visible');
  await expect(items).toHaveText([/Карта/, /Поиск/, /Избранное/, /Сравнение/]);
  for (const b of await items.all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.goto('/?nomap=1');
  await expect(items).toHaveText([/Поиск/, /Избранное/, /Сравнение/]);
});

test('sheet: 52 % on open, keyboard steps 18/52/92 %, Enter cycles', async ({ page }) => {
  await page.goto('/?nomap=1&p=elaman') // sheet behaviour does not need WebGL — keeps timing stable under load;
  await expect(page.locator('#panel-body h2')).toHaveText('ЖК Elaman');
  await expectSnap(page, 'half', 52);
  await page.locator('#panel-handle').focus();
  await page.keyboard.press('ArrowUp');
  await expectSnap(page, 'full', 92);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expectSnap(page, 'peek', 18);
  await page.keyboard.press('Enter');
  await expectSnap(page, 'half', 52);
  await expect(page.locator('#panel-handle')).toHaveAttribute('aria-label', /половина/);
});

test('sheet gestures: slow drag snaps to nearest, flick moves one state, flick down from 18 % closes', async ({ page }) => {
  await page.goto('/?nomap=1&p=elaman') // sheet behaviour does not need WebGL — keeps timing stable under load;
  await expect(page.locator('#panel-body h2')).toHaveText('ЖК Elaman');
  await expectSnap(page, 'half', 52);
  const a = await avail(page);
  await dragHandle(page, -a * 0.4, 900); // slow, ends near 92 %
  await expectSnap(page, 'full', 92);
  await dragHandle(page, a * 0.12, 60); // quick flick down: one state
  await expectSnap(page, 'half', 52);
  await dragHandle(page, a * 0.3, 900); // slow to ~22 % → nearest 18 %
  await expectSnap(page, 'peek', 18);
  await dragHandle(page, a * 0.1, 60); // flick down from peek → go up a level
  await expect(panel(page)).not.toHaveClass(/is-open/);
  expect(search(page).get('p')).toBeNull();
});

test('opening an apartment expands the sheet to 92 %; it stays above the bottom nav', async ({ page }) => {
  await page.goto('/?nomap=1&p=elaman');
  await page.locator('.chess [data-apt]').first().click();
  await expectSnap(page, 'full', 92);
  const p = (await panel(page).boundingBox())!, n = (await page.locator('#appnav').boundingBox())!;
  expect(p.y + p.height).toBeLessThanOrEqual(n.y + 3);
});

test('content scroll inside the sheet does not resize it', async ({ page }) => {
  await page.goto('/?nomap=1&p=aibat');
  await page.locator('#panel-handle').focus();
  await page.keyboard.press('ArrowUp');
  await expectSnap(page, 'full', 92);
  await page.locator('#panel-body').hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  expect(await snap(page)).toBe('full');
  expect(await page.locator('#panel-body').evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
});

test.describe('touch gestures on the map', () => {
  test('one finger pans, two fingers pinch-zoom', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'uses CDP touch events');
    await page.goto('/?cam=71.43,51.125,13,0,40');
    test.skip(!(await mapReady(page)), 'map unavailable');
    await page.waitForTimeout(1200);
    const camOf = () => new URL(page.url()).searchParams.get('cam')!.split(',').map(Number);
    const cdp = await page.context().newCDPSession(page);
    const box = (await page.locator('#map canvas').boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height * 0.55;
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: [number, number][]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });

    const a = camOf();
    await touch('touchStart', [[cx, cy]]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[cx + i * 12, cy + i * 6]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(1500);
    const b = camOf();
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeGreaterThan(0.0005);

    await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[cx - 30 - i * 12, cy], [cx + 30 + i * 12, cy]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(1500);
    expect(camOf()[2]).toBeGreaterThan(b[2] + 0.3);
  });
});
