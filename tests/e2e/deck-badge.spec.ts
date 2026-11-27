import { test, expect } from '@playwright/test';

test('clicking the card count under a deck opens the deck menu', async ({ page }, testInfo) => {
  await page.goto('/'); await page.getByRole('button', { name: /Start a new room/i }).click(); await page.waitForURL(/\/room\//);
  await page.getByLabel('Your name').fill('Maya'); await page.getByRole('button', { name: /Enter room/i }).click();
  await expect(page.getByText('Live')).toBeVisible();
  await page.getByRole('button', { name: /Card deck/ }).click();
  const deckDot = page.locator('.mini-grid i[data-type="deck"]'); await expect(deckDot).toHaveAttribute('data-count', '52');
  const deck = await deckDot.evaluate((node) => ({ x: Number(node.getAttribute('data-x')), y: Number(node.getAttribute('data-y')) }));
  const canvas = page.locator('canvas').first();
  // The count badge sits just below the 94px-tall card: 47 + 15 px under the deck's center.
  await canvas.click({ position: { x: deck.x, y: deck.y + 62 } });
  const menu = page.locator('.selection-bar');
  await expect(menu).toBeVisible();
  for (const name of ['Draw', 'Shuffle', 'Reset']) await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(deckDot).toHaveAttribute('data-count', '52'); // tapping the badge draws nothing
  // The deck is not left draggable: once deselected, pressing its body still draws a card.
  await canvas.click({ position: { x: deck.x - 150, y: deck.y } }); await expect(menu).toBeHidden();
  await canvas.click({ position: deck }); await expect(deckDot).toHaveAttribute('data-count', '51');
  await expect(page.locator('.mini-grid i[data-type="card"]')).toHaveCount(1);
});

test('clicking the card count under an image deck opens the deck menu', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: /Start a new room/i }).click(); await page.waitForURL(/\/room\//);
  await page.getByLabel('Your name').fill('Maya'); await page.getByRole('button', { name: /Enter room/i }).click();
  await expect(page.getByText('Live')).toBeVisible();
  await page.getByLabel('Make deck from images').setInputFiles(['example/imagens/fracao-1-um-meio.png', 'example/imagens/fracao-2-um-terco.png']);
  const deckDot = page.locator('.mini-grid i[data-type="deck"]'); await expect(deckDot).toHaveAttribute('data-count', '2');
  const deck = await deckDot.evaluate((node) => ({ x: Number(node.getAttribute('data-x')), y: Number(node.getAttribute('data-y')) }));
  await page.waitForTimeout(500);
  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: deck.x, y: deck.y + 75 + 15 } });
  const menu = page.locator('.selection-bar');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Shuffle', exact: true })).toBeVisible();
  await expect(deckDot).toHaveAttribute('data-count', '2');
});

test('a click on the count that wobbles a couple of pixels still opens the deck menu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'uses the mouse');
  await page.goto('/'); await page.getByRole('button', { name: /Start a new room/i }).click(); await page.waitForURL(/\/room\//);
  await page.getByLabel('Your name').fill('Maya'); await page.getByRole('button', { name: /Enter room/i }).click();
  await expect(page.getByText('Live')).toBeVisible();
  await page.getByRole('button', { name: /Card deck/ }).click();
  const deckDot = page.locator('.mini-grid i[data-type="deck"]'); await expect(deckDot).toHaveAttribute('data-count', '52');
  const deck = await deckDot.evaluate((node) => ({ x: Number(node.getAttribute('data-x')), y: Number(node.getAttribute('data-y')) }));
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(box.x + deck.x, box.y + deck.y + 62); await page.mouse.down();
  await page.mouse.move(box.x + deck.x + 2, box.y + deck.y + 63, { steps: 2 }); await page.mouse.up();
  await expect(page.locator('.selection-bar')).toBeVisible();
  const after = await deckDot.evaluate((node) => ({ x: Number(node.getAttribute('data-x')), y: Number(node.getAttribute('data-y')) }));
  expect(after).toEqual(deck); // a wobble that small does not move the deck
});
