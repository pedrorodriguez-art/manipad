import { test, expect, type Page } from '@playwright/test';
import { solidPng } from './png';

const point = async (page: Page, selector: string) => page.locator(selector).first().evaluate((node) => ({ x: Number(node.getAttribute('data-x')), y: Number(node.getAttribute('data-y')) }));

test('makes a deck from image files, one card per image, first file on top', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'uses mouse clicks on the canvas');
  await page.goto('/'); await page.getByRole('button', { name: /Start a new room/i }).click(); await page.waitForURL(/\/room\//);
  await page.getByLabel('Your name').fill('Maya'); await page.getByRole('button', { name: /Enter room/i }).click();
  await expect(page.getByText('Live')).toBeVisible();

  const imageResponse = page.waitForResponse((r) => r.url().includes('/card-images/'));
  await page.getByLabel('Make deck from images').setInputFiles([
    { name: 'card 10.png', mimeType: 'image/png', buffer: solidPng(60, 90, [40, 120, 220]) },
    { name: 'card 2.png', mimeType: 'image/png', buffer: solidPng(60, 90, [220, 60, 70]) },
    { name: 'card 1.png', mimeType: 'image/png', buffer: solidPng(60, 90, [40, 170, 110]) },
  ]);
  await expect(page.locator('.mini-grid i[data-type="deck"]')).toHaveAttribute('data-count', '3');

  const canvas = page.locator('canvas').first(); const box = (await canvas.boundingBox())!;
  const deck = await point(page, '.mini-grid i[data-type="deck"]');
  await page.mouse.click(box.x + deck.x, box.y + deck.y);
  const card = page.locator('.mini-grid i[data-type="card"]');
  await expect(card).toHaveCount(1); await expect(card).toHaveAttribute('data-face', '');
  const drawn = await point(page, '.mini-grid i[data-type="card"]');
  await page.mouse.click(box.x + drawn.x, box.y + drawn.y);
  await expect(card).toHaveAttribute('data-face', 's1:0'); // "card 1.png"
  const response = await imageResponse; expect(response.status()).toBe(200); expect(response.headers()['content-type']).toBe('image/jpeg');
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('image-deck.png') });
});

test('shows progress while a deck is made from many images', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one browser is enough');
  await page.goto('/'); await page.getByRole('button', { name: /Start a new room/i }).click(); await page.waitForURL(/\/room\//);
  await page.getByLabel('Your name').fill('Maya'); await page.getByRole('button', { name: /Enter room/i }).click();
  await expect(page.getByText('Live')).toBeVisible();
  const files = Array.from({ length: 30 }, (_, i) => ({ name: `card ${i + 1}.png`, mimeType: 'image/png', buffer: solidPng(900, 1300, [i * 8, 120, 200]) }));
  // Record every state the indicator goes through, so a fast machine cannot slip past it.
  await page.evaluate(() => { const seen: string[] = ((window as any).__uploadSeen = []); new MutationObserver(() => { const el = document.querySelector('.upload-progress'); const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Deck from images')) as HTMLButtonElement | undefined; const entry = el ? `${el.textContent}|${button?.disabled}` : 'hidden'; if (seen.at(-1) !== entry) seen.push(entry); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); });
  await page.getByLabel('Make deck from images').setInputFiles(files);
  await expect(page.locator('.mini-grid i[data-type="deck"]')).toHaveAttribute('data-count', '30', { timeout: 20_000 });
  await expect(page.locator('.upload-progress')).toBeHidden();
  await expect(page.getByRole('button', { name: /Deck from images/ })).toBeEnabled();
  const seen: string[] = await page.evaluate(() => (window as any).__uploadSeen);
  expect(seen).toContain('Preparing images… 0 of 30|true');
  expect(seen).toContain('Preparing images… 15 of 30|true');
  expect(seen).toContain('Uploading 30 cards…|true');
  expect(seen.at(-1)).toBe('hidden');
});
