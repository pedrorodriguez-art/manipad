import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '../../example');
const naipeExample = join(exampleDir, readdirSync(exampleDir).find((f) => f.startsWith('naipe-'))!);
const point = async (page: Page, selector: string) => page.locator(selector).first().evaluate((node) => ({ x: Number(node.getAttribute('data-x')), y: Number(node.getAttribute('data-y')) }));

test('imports a Naipe deck, draws its top card and flips it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'uses mouse clicks on the canvas');
  await page.goto('/'); await page.getByRole('button', { name: /Start a new room/i }).click(); await page.waitForURL(/\/room\//);
  await page.getByLabel('Your name').fill('Maya'); await page.getByRole('button', { name: /Enter room/i }).click();
  await expect(page.getByText('Live')).toBeVisible();

  await page.getByLabel('Import Naipe deck').setInputFiles(naipeExample);
  await expect(page.locator('.mini-grid i[data-type="deck"]')).toHaveAttribute('data-count', '3');

  // A click on the deck draws its top card face down next to it; a click on that card flips it.
  const canvas = page.locator('canvas').first(); const box = (await canvas.boundingBox())!;
  const deck = await point(page, '.mini-grid i[data-type="deck"]');
  await page.mouse.click(box.x + deck.x, box.y + deck.y);
  const card = page.locator('.mini-grid i[data-type="card"]');
  await expect(card).toHaveCount(1); await expect(card).toHaveAttribute('data-face', '');
  const drawn = await point(page, '.mini-grid i[data-type="card"]');
  await page.mouse.click(box.x + drawn.x, box.y + drawn.y);
  await expect(card).toHaveAttribute('data-face', 's1:0');
  await page.screenshot({ path: testInfo.outputPath('imported-deck.png') });
});
