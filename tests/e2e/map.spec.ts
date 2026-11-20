import { test, expect, type Page } from '@playwright/test';
import { mapReady, search } from './helpers';

// These tests need WebGL (SwiftShader in headless Chrome) and network access to the OpenFreeMap CDN.
// If the map cannot start they are skipped, not failed — the list-path specs cover the same scenario.

type Cam = { lng: number; lat: number; zoom: number; bearing: number; pitch: number };
const cam = (page: Page) => page.evaluate(() => {
  const q = new URLSearchParams(location.search).get('cam');
  if (!q) return null;
  const [lng, lat, zoom, bearing, pitch] = q.split(',').map(Number);
  return { lng, lat, zoom, bearing, pitch } as Cam;
});
const START = 'cam=71.43,51.125,14,0,45';

/** Wait until the camera in the URL (written 350 ms after moveend) stops changing. */
async function settle(page: Page) {
  let prev = '', stable = 0;
  for (let i = 0; i < 30 && stable < 2; i++) {
    await page.waitForTimeout(250);
    const now = new URL(page.url()).searchParams.get('cam') || '';
    stable = now && now === prev ? stable + 1 : 0;
    prev = now;
  }
}
async function drag(page: Page, dx: number, dy: number, mods: ('Shift')[] = []) {
  const box = (await page.locator('#map canvas').boundingBox())!;
  const x = box.x + box.width * 0.55, y = box.y + box.height * 0.6;
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 8 });
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
  await settle(page);
}

test.describe('3D map navigation (desktop)', () => {
  // SwiftShader renders on the CPU; under full-suite load a drag can be starved. One retry, reported as «flaky».
  test.describe.configure({ retries: 1 });
  test.skip(({ isMobile }) => isMobile, 'mouse navigation is desktop-only');

  test.beforeEach(async ({ page }) => {
    await page.goto(`/?${START}`);
    test.skip(!(await mapReady(page)), 'map/WebGL or tiles unavailable');
    await settle(page);
  });

  for (const [name, dx, dy] of [['right', 160, 0], ['left', -160, 0], ['down', 0, 120], ['up', 0, -120], ['diagonal', 120, 90]] as const) {
    test(`plain left-drag pans (${name}) without changing bearing/pitch or opening anything`, async ({ page }) => {
      const a = (await cam(page))!;
      await drag(page, dx, dy);
      const b = (await cam(page))!;
      expect(Math.hypot(b.lng - a.lng, b.lat - a.lat)).toBeGreaterThan(0.0005);
      expect(Math.abs(b.bearing - a.bearing)).toBeLessThan(0.5);
      expect(Math.abs(b.pitch - a.pitch)).toBeLessThan(0.5);
      expect(search(page).get('p')).toBeNull();
    });
  }

  test('Shift+left-drag: horizontal = bearing, vertical = pitch (clamped 0–75°)', async ({ page }) => {
    const a = (await cam(page))!;
    await drag(page, 200, 0, ['Shift']);
    const b = (await cam(page))!;
    expect(Math.abs(b.bearing - a.bearing)).toBeGreaterThan(20);
    expect(Math.hypot(b.lng - a.lng, b.lat - a.lat)).toBeLessThan(0.0005);
    await drag(page, 0, -400, ['Shift']);
    const c = (await cam(page))!;
    expect(c.pitch).toBeGreaterThan(b.pitch);
    expect(c.pitch).toBeLessThanOrEqual(75);
    await drag(page, 0, 900, ['Shift']);
    expect((await cam(page))!.pitch).toBeGreaterThanOrEqual(0);
  });

  test('«Вращать» mode swaps the roles; the choice survives reload', async ({ page }) => {
    await page.locator('[data-drag-mode="rotate"]').click();
    const a = (await cam(page))!;
    await drag(page, 200, 0);
    expect(Math.abs((await cam(page))!.bearing - a.bearing)).toBeGreaterThan(20);
    await page.reload();
    await expect(page.locator('[data-drag-mode="rotate"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-drag-mode="pan"]').click();
  });

  test('middle button (wheel pressed) drag rotates and pitches the scene', async ({ page }) => {
    const a = (await cam(page))!;
    const box = (await page.locator('#map canvas').boundingBox())!;
    const x = box.x + box.width * 0.55, y = box.y + box.height * 0.6;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(x + 100, y - 60, { steps: 6 });
    await page.mouse.move(x + 200, y - 120, { steps: 6 });
    await page.mouse.up({ button: 'middle' });
    await settle(page);
    const b = (await cam(page))!;
    expect(Math.abs(b.bearing - a.bearing)).toBeGreaterThan(20);
    expect(b.pitch).toBeGreaterThan(a.pitch);
    expect(Math.hypot(b.lng - a.lng, b.lat - a.lat)).toBeLessThan(0.0005);
  });

  test('attribution is a collapsed info button that expands on click (ODbL credit kept)', async ({ page }) => {
    const attrib = page.locator('.maplibregl-ctrl-attrib');
    await expect(attrib).not.toHaveClass(/maplibregl-compact-show/);
    await page.locator('.maplibregl-ctrl-attrib-button').click();
    await expect(attrib).toHaveClass(/maplibregl-compact-show/);
    await expect(attrib).toContainText('OpenStreetMap');
    await expect(page.locator('.footer')).not.toContainText('OpenStreetMap');
  });

  test('crime heat layer is off by default, toggles on with source and persists', async ({ page }) => {
    const box = page.locator('#layers');
    await box.locator('summary').click();
    const crime = box.locator('[data-layer="crime"]');
    await expect(crime).not.toBeChecked();
    await expect(box.locator('[data-layer="education"]')).toBeChecked();
    await expect(box.locator('[data-layer="medicine"]')).toBeChecked();
    await crime.check();
    await expect(box.locator('.layers__src')).toContainText('Генпрокуратуры РК');
    await expect(box.locator('.layers__src')).toContainText('не оценка безопасности');
    await page.reload();
    await mapReady(page);
    await page.locator('#layers summary').click();
    await expect(page.locator('#layers [data-layer="crime"]')).toBeChecked();
    await page.locator('#layers [data-layer="crime"]').uncheck();
  });

  test('POI are clickable: popup with kind, name and OSM source', async ({ page, request }) => {
    // centre the camera exactly on a known school from the published layer, then click the map centre like a user
    const { pois } = await (await request.get('/data/poi-city.json')).json() as { pois: { cat: string; name: string | null; c: [number, number] }[] };
    const school = pois.find((p) => p.cat === 'education' && p.name)!;
    await page.goto(`/?cam=${school.c[0]},${school.c[1]},16.5,0,0`);
    test.skip(!(await mapReady(page)), 'map unavailable');
    await settle(page);
    const box = (await page.locator('#map canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const pop = page.locator('.cpopup');
    await expect(pop).toBeVisible();
    await expect(pop.locator('.cpop__kind')).toHaveText(/Школа|Детский сад|Колледж|Университет/);
    await expect(pop.locator('h3')).toHaveText(school.name!);
    await expect(pop.locator('.cpop__src')).toContainText('OpenStreetMap');
  });

  test('list mode keeps the map visible and flies to the chosen project', async ({ page }) => {
    await page.locator('[data-view="list"]').click();
    await expect(page.locator('#map')).toBeVisible();
    const w = (await page.locator('#filters').boundingBox())!.width;
    expect(Math.round(w)).toBe(231); // 210 px + 10 %
    await page.locator('[data-list-slug="aibat"]').click();
    await expect(page.locator('#panel-body h2')).toHaveText('ЖК Aibat');
    await settle(page);
    const c = (await cam(page))!;
    expect(c.zoom).toBeGreaterThan(15);
    expect(Math.hypot(c.lng - 71.369, c.lat - 51.171)).toBeLessThan(0.01);
  });

  test('flag pole starts on the roof: marker is lifted, pole stays short', async ({ page }) => {
    await page.goto('/?cam=71.3595,51.1238,16.3,-25,60');
    test.skip(!(await mapReady(page)), 'map unavailable');
    await settle(page);
    const f = page.getByLabel(/^ЖК Qadam, сдача/);
    const pole = await f.evaluate((e) => parseFloat(getComputedStyle(e).getPropertyValue('--pole')));
    expect(pole).toBeLessThanOrEqual(26 + 30 * 6);
    // MapLibre applies the lift as a marker offset: the element's transform contains a negative y translate on top of the point
    const lifted = await f.evaluate((e) => {
      const nums = [...(e as HTMLElement).style.transform.matchAll(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/g)].map((m) => +m[2]);
      return nums.length ? nums[nums.length - 1] : null;
    });
    expect(lifted).not.toBeNull();
    const pole2 = await page.getByLabel(/^ЖК Qadam, сдача/).boundingBox();
    expect(pole2!.height).toBeLessThan(26 + 34 + 30 * 6 + 10); // short pole + pennant, not a pole from the ground
  });

  test('layers sit in the bottom-left corner and shift right of the open left menu', async ({ page }) => {
    const menu = (await page.locator('#filters').boundingBox())!;
    const layers = (await page.locator('#layers').boundingBox())!;
    expect(layers.x).toBeGreaterThanOrEqual(menu.x + menu.width); // menu visible → right of it
    expect(page.viewportSize()!.height - (layers.y + layers.height)).toBeLessThan(60); // bottom
    await page.locator('[data-list-slug="aibat"]').click();
    await expect(page.locator('#panel-body h2')).toHaveText('ЖК Aibat');
    await page.waitForTimeout(400);
    expect((await page.locator('#layers').boundingBox())!.x).toBeLessThanOrEqual(20); // menu hidden → corner
  });

  test('wheel zooms', async ({ page }) => {
    const a = (await cam(page))!;
    const box = (await page.locator('#map canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await settle(page);
    expect((await cam(page))!.zoom).toBeGreaterThan(a.zoom);
  });

  test('flag of a project under construction: name + deadline, click opens it, flag turns selected', async ({ page }) => {
    await page.goto('/?cam=71.3595,51.1238,16.3,-25,60');
    test.skip(!(await mapReady(page)), 'map unavailable');
    const flag = page.getByLabel(/^ЖК Qadam, сдача/);
    await expect(flag).toBeVisible();
    await expect(flag).toContainText('сдача: IV кв. 2026');
    await expect(flag).toHaveAttribute('aria-label', /ЖК Qadam, сдача/);
    await flag.locator('.zhk-flag__pennant').click();
    await expect(page.locator('#panel-body h2')).toHaveText('ЖК Qadam');
    await expect(flag).toHaveClass(/is-selected/);
  });

  test('status colours: under construction = green, completed = blue (legend, flags)', async ({ page }) => {
    const legend = page.locator('#legend span');
    await expect(legend.filter({ hasText: 'строится' }).locator('i')).toHaveCSS('background-color', 'rgb(47, 191, 113)');
    await expect(legend.filter({ hasText: 'сдан' }).locator('i')).toHaveCSS('background-color', 'rgb(79, 124, 255)');
    await page.goto('/?cam=71.3595,51.1238,16.3,-25,60');
    test.skip(!(await mapReady(page)), 'map unavailable');
    await expect(page.getByLabel(/^ЖК Qadam, сдача/).locator('.zhk-flag__pennant')).toHaveCSS('background-color', 'rgb(47, 191, 113)');
  });

  test('camera survives open/close of a project and Back', async ({ page }) => {
    await page.goto('/?cam=71.3595,51.1238,16.3,-25,60');
    test.skip(!(await mapReady(page)), 'map unavailable');
    await settle(page);
    const city = (await cam(page))!;
    await page.locator('[data-list-slug="qadam"]').click();
    await expect(page.locator('#panel-body h2')).toHaveText('ЖК Qadam');
    await page.waitForTimeout(1800);
    await page.goBack();
    await settle(page);
    const back = (await cam(page))!;
    expect(Math.abs(back.zoom - city.zoom)).toBeLessThan(0.3);
    expect(Math.hypot(back.lng - city.lng, back.lat - city.lat)).toBeLessThan(0.002);
  });
});
