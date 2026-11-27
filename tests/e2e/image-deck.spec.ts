import { deflateSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';

/** A solid-color PNG, so the test needs no fixture files. */
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
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
