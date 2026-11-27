import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { solidPng } from './png';

const dots = (page: Page) => page.locator('.mini-grid i');
/** What the board shows, position by position, read from the minimap (sorted, so the order of objects does not matter). */
const boardState = (page: Page) => dots(page).evaluateAll((nodes) => nodes.map((n) => ['type', 'x', 'y', 'count', 'face', 'hand', 'owner', 'value', 'sides', 'die-faces']
  .map((key) => `${key}=${(n.getAttribute(`data-${key}`) ?? '').replace(/\/api\/rooms\/[^|]+/g, 'picture')}`).join(' ')).sort());

async function enter(page: Page, name: string, url?: string) {
  if (url) await page.goto(url); else { await page.goto('/'); await page.getByRole('button', { name: /Start a new room/i }).click(); await page.waitForURL(/\/room\//); }
  await page.getByLabel('Your name').fill(name); await page.getByRole('button', { name: /Enter room/i }).click();
  await expect(page.getByText('Live')).toBeVisible();
}
async function newPlayer(browser: Browser, name: string, url?: string) { const context = await browser.newContext(); const page = await context.newPage(); await enter(page, name, url); return page; }
const toast = (page: Page) => page.locator('.error-toast');

test('the tutor exports a board and opens it in another room; everyone there gets it', async ({ browser }, testInfo) => {
  test.slow(testInfo.project.name === 'tablet', 'three browsers in a row on the slower tablet profile');
  const maya = await newPlayer(browser, 'Maya');
  await maya.getByRole('button', { name: /Card deck/ }).click(); await maya.getByRole('button', { name: /Die/ }).click();
  await maya.getByLabel('Make deck from images').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: solidPng(60, 90, [40, 120, 220]) }, { name: 'b.png', mimeType: 'image/png', buffer: solidPng(60, 90, [220, 60, 70]) }]);
  await expect(dots(maya)).toHaveCount(3);
  const deck = await maya.locator('.mini-grid i[data-type="deck"][data-count="52"]').evaluate((n) => ({ x: Number(n.getAttribute('data-x')), y: Number(n.getAttribute('data-y')) }));
  await maya.locator('canvas').first().click({ position: deck }); await expect(dots(maya)).toHaveCount(4); // a card drawn from the deck
  const saved = await boardState(maya);

  const downloading = maya.waitForEvent('download'); await maya.getByRole('button', { name: /Board file/ }).click(); await maya.getByRole('menuitem', { name: /Export board/ }).click();
  const download = await downloading; expect(download.suggestedFilename()).toMatch(/^manipad-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/);
  const path = testInfo.outputPath('board.json'); await download.saveAs(path);
  const file = JSON.parse(readFileSync(path, 'utf8'));
  expect(file).toMatchObject({ format: 'manipad-board', version: 1 }); expect(file.objects).toHaveLength(4); expect(Object.keys(file.assets)).toHaveLength(2);
  await maya.context().close();

  // A new room, with a student already in it.
  const ana = await newPlayer(browser, 'Ana'); await ana.getByRole('button', { name: /Counter/ }).click(); await expect(dots(ana)).toHaveCount(1);
  const leo = await newPlayer(browser, 'Leo', ana.url()); await expect(dots(leo)).toHaveCount(1);
  await expect(leo.getByRole('button', { name: /Board file/ })).toHaveCount(0); // students cannot save or open boards

  await ana.getByLabel('Import board file').setInputFiles(path);
  const confirm = ana.getByRole('alertdialog', { name: 'Replace the board?' });
  await expect(confirm).toContainText('for everyone in this room');
  await confirm.getByRole('button', { name: 'Cancel' }).click(); await expect(confirm).toBeHidden(); await expect(dots(leo)).toHaveCount(1);
  await ana.getByLabel('Import board file').setInputFiles(path);
  await ana.getByRole('alertdialog', { name: 'Replace the board?' }).getByRole('button', { name: 'Replace board' }).click();
  await expect(dots(ana)).toHaveCount(4); await expect(dots(leo)).toHaveCount(4);
  expect(await boardState(ana)).toEqual(saved); expect(await boardState(leo)).toEqual(saved);
  // The image deck's pictures came along: saving the new room gives back the same pictures.
  const anaRoom = ana.url().split('/room/')[1], anaToken = await ana.evaluate((id) => localStorage.getItem(`manipad-tutor-${id}`), anaRoom);
  const again = await (await ana.request.get(`/api/rooms/${anaRoom}/board-file`, { headers: { 'X-Tutor-Token': anaToken! } })).json();
  expect(Object.values(again.assets).map((a) => (a as { data: string }).data).sort()).toEqual(Object.values(file.assets).map((a) => (a as { data: string }).data).sort());
  await Promise.all([ana, leo].map((p) => p.context().close()));
});

test('broken, foreign, future and invalid files give a clear message and leave the board alone', async ({ page }, testInfo) => {
  await enter(page, 'Maya');
  await page.getByRole('button', { name: /Counter/ }).click(); await expect(dots(page)).toHaveCount(1);
  const before = await boardState(page);
  const open = async (name: string, content: string) => page.getByLabel('Import board file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) });

  await open('broken.json', '{"format":"manipad-board","objects":[');
  await expect(toast(page)).toContainText('That file is not valid JSON'); await toast(page).click();
  await open('other.json', '{"name":"not a board"}');
  await expect(toast(page)).toContainText('That is not a ManiPad board file'); await toast(page).click();
  await open('future.json', '{"format":"manipad-board","version":7,"objects":[],"cardSets":[],"assets":{}}');
  await expect(toast(page)).toContainText('saved by a newer version of ManiPad'); await toast(page).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0); // none of these got as far as asking

  // Looks fine to the browser; the server finds the bad card and refuses the whole file.
  await open('bad-card.json', JSON.stringify({ format: 'manipad-board', version: 1, objects: [{ id: 'x', type: 'card', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, z: 0, locked: false, creator: 'a', revision: 0, rank: '', suit: '♠', faceUp: true }], cardSets: [], assets: {} }));
  await page.getByRole('alertdialog').getByRole('button', { name: 'Replace board' }).click();
  await expect(toast(page)).toContainText('invalid object (#1, card)');
  expect(await boardState(page)).toEqual(before);
});

test('only the tutor can download or replace a board, and oversized files are refused', async ({ browser }) => {
  const maya = await newPlayer(browser, 'Maya'); const room = maya.url().split('/room/')[1];
  const token = await maya.evaluate((id) => localStorage.getItem(`manipad-tutor-${id}`), room);
  const endpoint = `/api/rooms/${room}/board-file`;
  expect((await maya.request.get(endpoint)).status()).toBe(403);
  expect((await maya.request.get(endpoint, { headers: { 'X-Tutor-Token': 'guess' } })).status()).toBe(403);
  expect((await maya.request.put(endpoint, { headers: { 'Content-Type': 'application/json' }, data: '{}' })).status()).toBe(403);
  expect((await maya.request.get(endpoint, { headers: { 'X-Tutor-Token': token! } })).status()).toBe(200);
  const huge = await maya.request.put(endpoint, { headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': token! }, data: `{"pad":"${'a'.repeat(46_000_000)}"}` });
  expect(huge.status()).toBe(413); expect((await huge.json()).message).toMatch(/too large/);
  await maya.context().close();
});
