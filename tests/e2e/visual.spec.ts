import { test, expect, type Page } from '@playwright/test';
import { ready } from './helpers';

// Visual regression in list mode (no WebGL/tiles). External photos and plans from svoydom.kz are masked,
// so only our own UI is compared. Update baselines with: npm run test:e2e:update
async function stable(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}
const masks = (page: Page) => [page.locator('img'), page.locator('.hero')];

test.describe('visual', () => {
  test('city list', async ({ page }) => {
    await page.goto('/?nomap=1');
    await ready(page);
    await stable(page);
    await expect(page).toHaveScreenshot('city-list.png', { mask: masks(page) });
  });

  test('project chessboard', async ({ page }) => {
    await page.goto('/?nomap=1&p=elaman');
    await expect(page.locator('.chess')).toBeVisible();
    await stable(page);
    await expect(page).toHaveScreenshot('project-chess.png', { mask: masks(page) });
  });

  test('apartment card with mortgage', async ({ page }) => {
    await page.goto('/?nomap=1&p=elaman&a=63315');
    await expect(page.locator('#mortgage .mort__res')).toBeVisible();
    await stable(page);
    await expect(page.locator('#panel')).toHaveScreenshot('apartment-card.png', { mask: masks(page) });
  });

  test('search with filters', async ({ page }) => {
    await page.goto('/?nomap=1&v=search&ar=3&so=area-desc');
    await expect(page.locator('.view .arow').first()).toBeVisible();
    await stable(page);
    await expect(page.locator('#view')).toHaveScreenshot('search.png', { mask: masks(page) });
  });

  test('compare table', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('svoydom3d-compare', JSON.stringify(['aqterek:58413', 'aqterek:58419', 'elaman:63315'])));
    await page.goto('/?nomap=1&v=compare');
    await expect(page.locator('.cmp')).toBeVisible();
    await stable(page);
    await expect(page.locator('#view')).toHaveScreenshot('compare.png', { mask: masks(page) });
  });

  test('chessboard cell states legend', async ({ page }) => {
    await page.goto('/?nomap=1&p=aqterek&ar=2');
    await expect(page.locator('.chess .cell.is-dim').first()).toBeVisible();
    await stable(page);
    await expect(page.locator('.chess')).toHaveScreenshot('chess-dimmed.png');
  });
});
