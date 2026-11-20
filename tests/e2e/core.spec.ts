import { test, expect } from '@playwright/test';
import { trackErrors, ready, search, freshStorage } from './helpers';

test.describe('core scenario (list path, works without 3D)', () => {
  test('concept disclaimers, noindex and no console errors', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?nomap=1');
    await ready(page);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
    await expect(page.locator('#disclaimer-top')).toContainText('Концепт-демо для SVOYDOM. Не официальный сайт. Данные с svoydom.kz на');
    await expect(page.locator('#disclaimer-bottom')).toContainText('Не официальный сайт');
    expect(errors).toEqual([]);
  });

  test('list → project → apartment → Back → Back → Forward, URL levels', async ({ page }) => {
    const errors = trackErrors(page);
    await freshStorage(page);
    await page.goto('/?nomap=1');
    await ready(page);
    await page.locator('[data-list-slug="elaman"]').click();
    await expect(page.locator('#panel-body h2')).toHaveText('ЖК Elaman');
    expect(search(page).get('p')).toBe('elaman');

    // honest coverage labelling
    await expect(page.locator('.note').filter({ hasText: 'Каталог неполный: 12 из 36' })).toBeVisible();
    await expect(page.locator('.chess .cell--unknown').first()).toHaveText('данных нет');

    const cell = page.locator('.chess [data-apt]').first();
    const label = await cell.getAttribute('aria-label');
    await cell.click();
    await expect(page.locator('.apt h2')).toBeVisible();
    await expect(page.locator('.badge-schematic')).toContainText('Этаж схематично');
    await expect(page.locator('.kv')).toContainText('нет подтверждённых данных');
    expect(search(page).get('a')).toBeTruthy();

    await page.goBack();
    await expect(page.locator('.apt')).toHaveCount(0);
    await expect(page.locator('.chess')).toBeVisible();
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', label!);
    expect(search(page).get('a')).toBeNull();

    await page.goBack();
    await expect(page.locator('#panel')).not.toHaveClass(/is-open/);
    expect(search(page).get('p')).toBeNull();

    await page.goForward();
    await expect(page.locator('#panel-body h2')).toHaveText('ЖК Elaman');
    expect(errors).toEqual([]);
  });

  test('refresh restores filters, project, apartment and tab from the URL', async ({ page }) => {
    await page.goto('/?nomap=1&st=b,c&cl=kp&r=2&p=elaman&a=63315');
    await expect(page.locator('.apt h2')).toHaveText('4-комнатная, 117.5 м²');
    await expect(page.locator('#filters-form .chip.is-on')).toHaveText(['Строится', 'Сдан', 'Комфорт+', '2']);
    await expect(page.locator('#project-list-h')).toHaveText(/ЖК в подборке: \d+/);
    await page.reload();
    await expect(page.locator('.apt h2')).toHaveText('4-комнатная, 117.5 м²');
  });

  test('legacy #slug deep link still opens the project', async ({ page }) => {
    await page.goto('/?nomap=1#qadam');
    await expect(page.locator('#panel-body h2')).toHaveText('ЖК Qadam');
  });

  test('keyboard only: Tab to list, Enter opens project and apartment, Escape goes up', async ({ page }) => {
    await page.goto('/?nomap=1');
    await ready(page);
    await page.locator('[data-list-slug="qadam"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#panel-body h2[data-focus-heading]')).toBeFocused();
    await expect(page.locator('#live')).toContainText('Открыт ЖК Qadam');
    await page.locator('.chess [data-apt]').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.apt h2')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.apt')).toHaveCount(0);
    await expect(page.locator(':focus')).toHaveAttribute('data-apt', /qadam:/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#panel')).not.toHaveClass(/is-open/);
    await expect(page.locator('[data-list-slug="qadam"]')).toBeFocused();
  });

  test('skip link focuses the project list', async ({ page }) => {
    await page.goto('/?nomap=1');
    await ready(page);
    await page.keyboard.press('Tab');
    await expect(page.locator('#skip-list')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#project-list-h')).toBeFocused();
  });

  test('project filters update list and URL; reset clears them', async ({ page }) => {
    await page.goto('/?nomap=1');
    await ready(page);
    const before = await page.locator('#project-list .plist__item').count();
    await page.locator('#filters-form [data-g="class"][data-v="Комфорт+"]').click();
    await expect(page.locator('#project-list .plist__item')).not.toHaveCount(before);
    expect(search(page).get('cl')).toBe('kp');
    await page.locator('#filters-form [data-g="reset"]').click();
    expect(search(page).get('cl')).toBeNull();
    expect(search(page).get('st')).toBeNull(); // reset = all statuses = default
  });

  test('API error shows an error state and retry recovers', async ({ page }) => {
    let fail = true;
    await page.route('**/data/apts/shalqar.json', (r) => (fail ? r.fulfill({ status: 503, body: 'down' }) : r.continue()));
    await page.goto('/?nomap=1');
    await ready(page);
    await page.locator('[data-list-slug="shalqar"]').click();
    await expect(page.locator('.state-error')).toContainText('Не удалось загрузить квартиры');
    fail = false;
    await page.locator('#retry-detail').click();
    await expect(page.locator('.chess')).toBeVisible();
  });

  test('projects.json failure shows a page-level error', async ({ page }) => {
    await page.route('**/data/projects.json', (r) => r.fulfill({ status: 500, body: '' }));
    await page.goto('/?nomap=1');
    await expect(page.locator('#filters-form .state-error')).toContainText('Не удалось загрузить список ЖК');
  });

  test('floors, sections and entrances quoted from svoydom.kz are shown', async ({ page }) => {
    await page.goto('/?nomap=1&p=aibat');
    await expect(page.locator('.stats')).toContainText('Этажность');
    await expect(page.locator('.stats')).toContainText('7 секц.');
    await page.locator('[data-tab="about"]').click();
    await expect(page.locator('#tabbody .note')).toContainText('По странице ЖК на svoydom.kz: этажность 12, 7 секций');
  });

  test('completed projects are listed by default (all statuses)', async ({ page }) => {
    await page.goto('/?nomap=1');
    await ready(page);
    await expect(page.locator('#project-list .plist__dot--done').first()).toBeVisible();
    await expect(page.locator('#filters-form .chip.is-on')).toHaveCount(0);
  });

  test('district tab shows crime within 500 m with the prosecutor source', async ({ page }) => {
    await page.goto('/?nomap=1&p=aibat&t=district');
    const row = page.locator('.dgroup').filter({ hasText: 'Преступность' });
    await expect(row).toContainText(/\d+ в 500 м за 12 мес\./);
    await expect(row).toContainText('Генеральной прокуратуры');
  });

  test('project without published apartments says «данных нет»', async ({ page }) => {
    await page.goto('/?nomap=1&p=tamgaly');
    await expect(page.locator('#panel-body .note--warn').first()).toContainText('данных нет');
    await expect(page.locator('.stats')).toContainText('данных нет');
  });
});
