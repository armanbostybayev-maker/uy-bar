import { test, expect, type Page } from '@playwright/test';
import { ready, search, freshStorage, trackErrors } from './helpers';

const openApartment = async (page: Page, url = '/?nomap=1&p=elaman&a=63315') => {
  await page.goto(url);
  await expect(page.locator('.apt h2')).toBeVisible();
};
const field = (page: Page, k: string) => page.locator(`#mortgage [data-k=${k}]`);
const result = (page: Page) => page.locator('#mortgage .mort__res');

test.describe('mortgage calculator in the apartment card', () => {
  test('default example, overpayment and total are shown', async ({ page }) => {
    await openApartment(page);
    await expect(result(page)).toContainText('Платёж в месяц');
    await expect(result(page)).toContainText('Переплата (проценты)');
    await expect(result(page)).toContainText('Всего выплат за 300 мес.');
    await expect(page.locator('#mortgage .note')).toContainText('не проверка участия в программе');
  });

  test('edge cases: 100 % down, 0 % rate, text, 0 and 1 month, >100 %', async ({ page }) => {
    await openApartment(page);
    await field(page, 'downPct').fill('100');
    await expect(result(page)).toContainText('Кредит не нужен');

    await field(page, 'downPct').fill('20');
    await field(page, 'ratePct').fill('0');
    await expect(result(page).locator('div').filter({ hasText: 'Переплата' })).toContainText('0 ₸');

    await field(page, 'ratePct').fill('abc');
    await expect(page.locator('[data-field=ratePct] .mfield__err')).toHaveText('Введите число, например 7 или 18,5');
    await expect(field(page, 'ratePct')).toHaveAttribute('aria-invalid', 'true');
    await expect(result(page)).toContainText('расчёт не выполняется');

    await field(page, 'ratePct').fill('7,5'); // comma decimal
    await expect(field(page, 'ratePct')).toHaveAttribute('aria-invalid', 'false');

    await field(page, 'term').fill('0');
    await expect(page.locator('[data-field=months] .mfield__err')).toHaveText('Срок — не меньше 1 месяца');
    await page.locator('#mortgage [data-k=unit]').selectOption('months');
    await field(page, 'term').fill('1');
    await expect(result(page)).toContainText('Всего выплат за 1 мес.');

    await field(page, 'downPct').fill('120');
    await expect(page.locator('[data-field=downPct] .mfield__err')).toHaveText('Взнос — от 0 до 100 %');

    await page.locator('#mortgage [data-reset]').click();
    await expect(field(page, 'downPct')).toHaveValue('20');
    await expect(result(page)).toContainText('Всего выплат за 300 мес.');
  });
});

test.describe('apartment search, favourites and compare', () => {
  test.beforeEach(async ({ page }) => { await freshStorage(page); });

  test('filters and sort from the URL, empty state and reset', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?nomap=1&v=search&ar=2&so=priceM2-asc');
    await expect(page.locator('.view__head')).toContainText('Поиск квартир');
    await expect(page.locator('.view [data-room="2"]')).toHaveAttribute('aria-pressed', 'true');
    const m2 = await page.locator('.view .arow__price .muted').allTextContents();
    const nums = m2.map((t) => Number(t.replace(/\D/g, '')));
    expect(nums.length).toBeGreaterThan(5);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    await expect(page.locator('.view .note--warn')).toContainText('каталог неполный');

    await page.locator('.view input[name=priceMax]').fill('1');
    await expect(page.locator('.view .empty')).toContainText('Ничего не найдено');
    expect(search(page).get('apx')).toBe('1');
    await page.locator('.view [data-empty-reset]').click();
    await expect(page.locator('.view .arow').first()).toBeVisible();
    expect(search(page).get('apx')).toBeNull();
    expect(errors).toEqual([]);
  });

  test('favourites and compare persist across reload; compare table marks differences', async ({ page }) => {
    await page.goto('/?nomap=1&v=search&ar=2&so=price-asc');
    const rows = page.locator('.view .arow');
    await rows.nth(0).locator('[data-fav]').click();
    await rows.nth(0).locator('[data-cmp]').click();
    await rows.nth(1).locator('[data-cmp]').click();
    await expect(page.locator('#fav-count')).toHaveText('1');
    await expect(page.locator('#cmp-count')).toHaveText('2');

    await page.reload();
    await expect(page.locator('#fav-count')).toHaveText('1');
    await page.locator('[data-view="compare"]').click();
    expect(search(page).get('v')).toBe('compare');
    await expect(page.locator('.cmp thead th')).toHaveCount(3);
    await expect(page.locator('.cmp tr.is-diff').first()).toBeVisible();
    await page.locator('[data-only-diff]').check();
    await expect(page.locator('.cmp tbody tr').filter({ hasText: 'Район' })).toHaveCount(0); // same district → hidden

    await page.locator('[data-view="fav"]').click();
    await expect(page.locator('.view .arow')).toHaveCount(1);

    await page.goBack();
    expect(search(page).get('v')).toBe('compare');
  });

  test('compare is capped at 4 with a message', async ({ page }) => {
    await page.goto('/?nomap=1&v=search');
    const rows = page.locator('.view .arow');
    for (let i = 0; i < 4; i++) await rows.nth(i).locator('[data-cmp]').click();
    await rows.nth(4).locator('[data-cmp]').click();
    await expect(page.locator('#toast')).toContainText('до 4 квартир');
    await expect(page.locator('#cmp-count')).toHaveText('4');
  });

  test('open apartment from compare, Back returns to the project', async ({ page }) => {
    await page.goto('/?nomap=1&v=search&ar=2&so=price-asc');
    const rows = page.locator('.view .arow');
    await rows.nth(0).locator('[data-cmp]').click();
    await rows.nth(1).locator('[data-cmp]').click();
    await page.locator('[data-view="compare"]').click();
    await page.locator('.cmp [data-open]').first().click();
    await expect(page.locator('.apt h2')).toBeVisible();
    await expect(page.locator('#apt-lists [data-apt-cmp]')).toHaveAttribute('aria-pressed', 'true');
    await page.goBack();
    await expect(page.locator('.apt')).toHaveCount(0);
    await expect(page.locator('#panel-body h2')).toBeVisible();
  });

  test('empty favourites and compare states', async ({ page }) => {
    await page.goto('/?nomap=1&v=fav');
    await expect(page.locator('.view .empty')).toContainText('Пока пусто');
    await page.locator('[data-view="compare"]').click();
    await expect(page.locator('.view .empty')).toContainText('Нечего сравнивать');
  });

  test('index load failure → error + retry', async ({ page }) => {
    let fail = true;
    await page.route('**/data/apartments-index.json', (r) => (fail ? r.fulfill({ status: 503, body: '' }) : r.continue()));
    await page.goto('/?nomap=1&v=search');
    await expect(page.locator('.view .state-error')).toContainText('Не удалось загрузить квартиры');
    fail = false;
    await page.locator('.view [data-retry]').click();
    await expect(page.locator('.view .arow').first()).toBeVisible();
  });

  test('project tab: filter dims cells in place; list view sorts', async ({ page }) => {
    await page.goto('/?nomap=1&p=aqterek&ar=2');
    await expect(page.locator('.apts-filter summary')).toContainText('подходит 7 из 12');
    await expect(page.locator('.chess .cell.is-dim')).toHaveCount(5);
    await expect(page.locator('.chess .cell[data-apt]')).toHaveCount(12); // positions unchanged
    await page.locator('[data-pv=list]').click();
    expect(search(page).get('pv')).toBe('list');
    await expect(page.locator('#apts-body .arow')).toHaveCount(7);
    await page.locator('.apts-filter select[name=sort]').selectOption('area-desc');
    const areas = (await page.locator('#apts-body .arow__title b').allTextContents()).map((t) => Number(t.match(/([\d.]+) м²/)![1]));
    expect(areas).toEqual([...areas].sort((a, b) => b - a));
  });
});
