import { test, expect, type Browser, type Page } from '@playwright/test';
import { solidPng } from './png';

const die = (page: Page) => page.locator('.mini-grid i[data-type="die"]');
const position = (page: Page, index = 0) => die(page).nth(index).evaluate((node) => ({ x: Number(node.getAttribute('data-x')), y: Number(node.getAttribute('data-y')) }));
const canvas = (page: Page) => page.locator('canvas').first();

async function enter(page: Page, name: string, url?: string) {
  if (url) await page.goto(url); else { await page.goto('/'); await page.getByRole('button', { name: /Start a new room/i }).click(); await page.waitForURL(/\/room\//); }
  await page.getByLabel('Your name').fill(name); await page.getByRole('button', { name: /Enter room/i }).click();
  await expect(page.getByText('Live')).toBeVisible();
}
async function twoPlayers(browser: Browser) {
  const a = await browser.newContext(), b = await browser.newContext(); const maya = await a.newPage(), leo = await b.newPage();
  await enter(maya, 'Maya'); await enter(leo, 'Leo', maya.url());
  return { maya, leo, close: async () => { await a.close(); await b.close(); } };
}

test('every roll is drawn by the server and shows the same value on every screen', async ({ browser }) => {
  const { maya, leo, close } = await twoPlayers(browser);
  await maya.getByRole('button', { name: /Die/ }).click();
  await expect(die(leo)).toHaveCount(1);
  await canvas(maya).click({ position: await position(maya) }); // selects it
  for (let roll = 1; roll <= 3; roll++) {
    await maya.locator('.selection-bar').getByRole('button', { name: 'Roll', exact: true }).click();
    await expect(die(maya)).toHaveAttribute('data-nonce', String(roll)); await expect(die(leo)).toHaveAttribute('data-nonce', String(roll));
    const value = Number(await die(maya).getAttribute('data-value'));
    expect(value).toBeGreaterThanOrEqual(1); expect(value).toBeLessThanOrEqual(6);
    await expect(die(leo)).toHaveAttribute('data-value', String(value));
  }
  await close();
});

test('several selected dice roll together, in one action', async ({ browser }) => {
  const { maya, leo, close } = await twoPlayers(browser);
  await maya.getByRole('button', { name: /Die/ }).click(); await maya.getByRole('button', { name: /Die/ }).click();
  await expect(die(leo)).toHaveCount(2);
  await canvas(maya).click({ position: await position(maya, 0) }); await canvas(maya).click({ position: await position(maya, 1), modifiers: ['Shift'] });
  await maya.locator('.selection-bar').getByRole('button', { name: 'Roll 2 dice' }).click();
  for (const page of [maya, leo]) { await expect(die(page).nth(0)).toHaveAttribute('data-nonce', '1'); await expect(die(page).nth(1)).toHaveAttribute('data-nonce', '1'); }
  for (const i of [0, 1]) await expect(die(leo).nth(i)).toHaveAttribute('data-value', (await die(maya).nth(i).getAttribute('data-value'))!);
  await close();
});

test('a custom die with text faces, rolled by double or single tap', async ({ page }) => {
  await enter(page, 'Maya');
  await page.getByRole('button', { name: /Custom die/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Custom die' });
  await dialog.getByLabel('Number of faces').fill('3'); await dialog.getByLabel('Custom faces').check();
  const texts = ['Sim', 'Não', 'Talvez'];
  for (const [i, text] of texts.entries()) await dialog.getByLabel(`Face ${i + 1} text`).fill(text);
  await dialog.getByRole('button', { name: 'Create die' }).click();
  await expect(dialog).toBeHidden();
  await expect(die(page)).toHaveAttribute('data-sides', '3'); await expect(die(page)).toHaveAttribute('data-die-faces', texts.join('|'));
  expect(texts).toContain(await die(page).getAttribute('data-die-face'));

  // Default: a tap selects, a double tap rolls.
  const at = await position(page);
  await canvas(page).click({ position: at }); await expect(page.locator('.selection-bar')).toBeVisible(); await expect(die(page)).toHaveAttribute('data-nonce', '0');
  await page.waitForTimeout(400); // so the selecting tap and the double tap are not taken for another double tap
  await canvas(page).dblclick({ position: at }); await expect(die(page)).toHaveAttribute('data-nonce', '1');
  expect(texts).toContain(await die(page).getAttribute('data-die-face'));

  // "Single tap": one tap rolls; the choice is remembered by this browser.
  await page.getByRole('radio', { name: 'Single tap' }).click();
  await page.waitForTimeout(400); // let the double-tap window of the last taps close
  await canvas(page).click({ position: at }); await expect(die(page)).toHaveAttribute('data-nonce', '2');
  await page.reload(); await expect(page.getByText('Live')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Single tap' })).toHaveAttribute('aria-checked', 'true');

  // Editing: back to plain numbers, as a d4.
  await canvas(page).click({ position: at }); await expect(die(page)).toHaveAttribute('data-nonce', '3');
  await page.locator('.selection-bar').getByRole('button', { name: 'Edit die' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit die' });
  await edit.getByRole('button', { name: 'd4' }).click(); await edit.getByLabel('Custom faces').uncheck(); await edit.getByRole('button', { name: 'Save die' }).click();
  await expect(edit).toBeHidden();
  await expect(die(page)).toHaveAttribute('data-sides', '4'); await expect(die(page)).toHaveAttribute('data-die-faces', '');
  expect(['1', '2', '3', '4']).toContain(await die(page).getAttribute('data-die-face'));
});

test('a die with a picture face: the server keeps the picture, everyone loads it, a copy reuses it', async ({ browser }) => {
  const { maya, leo, close } = await twoPlayers(browser);
  await maya.getByRole('button', { name: /Custom die/ }).click();
  const dialog = maya.getByRole('dialog', { name: 'Custom die' });
  await dialog.getByLabel('Number of faces').fill('2'); await dialog.getByLabel('Custom faces').check();
  const chooser = maya.waitForEvent('filechooser'); await dialog.getByRole('button', { name: 'Face 1 picture' }).click();
  await (await chooser).setFiles({ name: 'star.png', mimeType: 'image/png', buffer: solidPng(300, 200, [230, 170, 40]) });
  await expect(dialog.getByRole('img', { name: 'Face 1' })).toBeVisible();
  await dialog.getByLabel('Face 2 text').fill('B');
  await dialog.getByRole('button', { name: 'Create die' }).click(); await expect(dialog).toBeHidden();

  await expect(die(leo)).toHaveAttribute('data-die-faces', /^img:\/api\/rooms\/[a-z0-9-]+\/card-images\/[A-Za-z0-9_-]{16}\|B$/);
  const url = (await die(leo).getAttribute('data-die-faces'))!.split('|')[0].slice(4);
  const response = await leo.request.get(url); expect(response.status()).toBe(200); expect(response.headers()['content-type']).toBe('image/png');
  // The picture travels once, to the server; boards only carry its URL.
  expect(await leo.locator('.mini-grid').innerHTML()).not.toContain('base64');

  await canvas(maya).click({ position: await position(maya) });
  await maya.locator('.selection-bar').getByRole('button', { name: 'Duplicate' }).click();
  await expect(die(leo)).toHaveCount(2);
  await expect(die(leo).nth(1)).toHaveAttribute('data-die-faces', `img:${url}|B`);
  await close();
});
