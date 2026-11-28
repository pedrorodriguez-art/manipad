import { test, expect, type Page } from '@playwright/test';
import { joinAsBot, objectBase, playingDeck } from './bot';

// The other e2e tests run with reduced motion (see playwright.config.ts); these turn motion on to check the animations.
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

async function enter(page: Page) {
  // These tests check what animates, not how fast this machine draws: headless browsers draw the board's shadows in
  // software, which can make even a small board "too heavy to animate" (see animation-performance.spec.ts for that).
  await page.addInitScript(() => { (window as unknown as { __manipadDrawBudgetMs: number }).__manipadDrawBudgetMs = Number.POSITIVE_INFINITY; });
  await page.goto('/'); await page.getByRole('button', { name: /Start a new room/i }).click(); await page.waitForURL(/\/room\//);
  await page.getByLabel('Your name').fill('Maya'); await page.getByRole('button', { name: /Enter room/i }).click();
  await expect(page.getByText('Live')).toBeVisible();
  return page.url().split('/room/')[1];
}
const log = (page: Page) => page.evaluate(() => [...((window as unknown as { __manipadAnimations?: string[] }).__manipadAnimations ?? [])]);
const clearLog = (page: Page) => page.evaluate(() => { (window as unknown as { __manipadAnimations?: string[] }).__manipadAnimations = []; });
/** Where the Konva node of an object is actually drawn right now. */
const drawn = (page: Page, id: string) => page.evaluate((id) => {
  const node = (window as unknown as { Konva: { stages: { findOne: (s: string) => { x(): number; y(): number; scaleX(): number; rotation(): number } | undefined }[] } }).Konva.stages[0].findOne(`#${id}`);
  return node && { x: Math.round(node.x()), y: Math.round(node.y()), scaleX: Math.round(node.scaleX() * 100) / 100, rotation: Math.round(node.rotation()) };
}, id);
const dot = (page: Page, id: string) => page.locator(`.mini-grid i[data-id="${id}"]`);
const baseURL = () => test.info().project.use.baseURL!;

test('what another player does animates on my screen, and ends exactly where the board says', async ({ page }, testInfo) => {
  const bot = await joinAsBot(baseURL(), await enter(page));
  await bot.run({ type: 'create', object: playingDeck('deck', 300, 220) });
  await expect(dot(page, 'deck')).toHaveCount(1); await clearLog(page);

  await bot.run({ type: 'drawCard', id: 'deck' });
  const card = bot.objects().find((o) => o.type === 'card')!;
  await expect.poll(() => log(page)).toContain(`draw:${card.id}`);
  await bot.run({ type: 'flipCard', id: card.id });
  await expect.poll(() => log(page)).toContain(`flip:${card.id}`);
  await bot.run({ type: 'update', ids: [card.id], patch: { x: 520, y: 400 } });
  await expect.poll(() => log(page)).toContain(`move:${card.id}`);
  await bot.run({ type: 'shuffleDeck', id: 'deck' });
  await expect.poll(() => log(page)).toContain('shuffle:deck');
  // Animations only show the change: each node settles on the state the server sent.
  await expect.poll(() => drawn(page, card.id)).toEqual({ x: 520, y: 400, scaleX: 1, rotation: 0 });
  await expect.poll(() => drawn(page, 'deck')).toEqual({ x: 300, y: 220, scaleX: 1, rotation: 0 });

  if (testInfo.project.name === 'desktop') {
    // My own drag is not replayed when the server confirms it.
    await clearLog(page);
    const box = (await page.locator('canvas').first().boundingBox())!;
    await page.mouse.move(box.x + 520, box.y + 400); await page.mouse.down(); await page.mouse.move(box.x + 420, box.y + 300, { steps: 6 }); await page.mouse.up();
    await expect(dot(page, card.id)).toHaveAttribute('data-x', '420');
    expect(await log(page)).not.toContain(`move:${card.id}`);
    await expect.poll(() => drawn(page, card.id)).toEqual({ x: 420, y: 300, scaleX: 1, rotation: 0 });
  }
  bot.close();
});

test.describe('with reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });
  test('nothing animates: changes just appear', async ({ page }) => {
    const bot = await joinAsBot(baseURL(), await enter(page));
    await bot.run({ type: 'create', object: playingDeck('deck', 300, 220) });
    await bot.run({ type: 'drawCard', id: 'deck' }); const card = bot.objects().find((o) => o.type === 'card')!;
    await bot.run({ type: 'flipCard', id: card.id }); await bot.run({ type: 'shuffleDeck', id: 'deck' });
    await bot.run({ type: 'update', ids: [card.id], patch: { x: 520, y: 400 } });
    await expect(dot(page, card.id)).toHaveAttribute('data-x', '520');
    expect(await drawn(page, card.id)).toEqual({ x: 520, y: 400, scaleX: 1, rotation: 0 });
    expect(await log(page)).toEqual([]);
    bot.close();
  });
});

test('many changes at once do not animate', async ({ page }) => {
  const bot = await joinAsBot(baseURL(), await enter(page));
  const ids = Array.from({ length: 31 }, (_, i) => `counter-${i}`);
  for (const [i, id] of ids.entries()) await bot.run({ type: 'create', object: { ...objectBase(id, 100 + (i % 8) * 60, 120 + Math.floor(i / 8) * 60), type: 'counter', color: '#3974e8', size: 40 } });
  await expect(page.locator('.mini-grid i')).toHaveCount(31); await clearLog(page);
  await bot.run({ type: 'update', ids, patch: { y: 500 } });
  await expect(dot(page, ids[30])).toHaveAttribute('data-y', '500');
  expect((await log(page)).filter((entry) => entry.startsWith('move:'))).toEqual([]);
  await bot.run({ type: 'update', ids: ids.slice(0, 3), patch: { y: 120 } });
  await expect.poll(async () => (await log(page)).filter((entry) => entry.startsWith('move:')).length).toBe(3);
  bot.close();
});
