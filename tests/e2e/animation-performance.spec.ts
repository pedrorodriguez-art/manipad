import { chromium, devices, test, expect, type Browser, type Page } from '@playwright/test';
import { joinAsBot, objectBase, playingDeck } from './bot';
import type { BoardCommand } from '../../src/shared/types';

/**
 * Frame times with a crowded table (150 face-up cards, two decks, four dice) while another player draws, flips, moves,
 * shuffles and rolls. Each action is measured with animations on and, as a baseline, with reduced motion (the board still
 * redraws, but nothing tweens). Two setups: the tablet profile as it runs (WebKit), and an iPad-sized Chromium with the
 * CPU slowed 4× (WebKit cannot be slowed down).
 */
type Stats = { frames: number; median: number; p95: number; max: number; long: number; animated: number; cut: number };
const ACTIONS: Record<string, (deck: string, cards: string[], dice: string[]) => BoardCommand[]> = {
  draw: (deck) => Array.from({ length: 6 }, () => ({ type: 'drawCard', id: deck })),
  flip: (_deck, cards) => cards.slice(0, 6).map((id) => ({ type: 'flipCard', id })),
  move: (_deck, cards) => cards.slice(6, 12).map((id, i) => ({ type: 'update', ids: [id], patch: { x: 120 + i * 90, y: 640 } })),
  shuffle: (deck) => [{ type: 'shuffleDeck', id: deck }, { type: 'shuffleDeck', id: deck }, { type: 'shuffleDeck', id: deck }],
  roll: (_deck, _cards, dice) => [{ type: 'rollDice', ids: dice }, { type: 'rollDice', ids: dice }],
};

async function crowdedTable(browser: Browser, reducedMotion: 'reduce' | 'no-preference', slowdown: number) {
  const { defaultBrowserType: _engine, ...ipad } = devices['iPad (gen 7)'];
  const context = await browser.newContext({ ...ipad, baseURL: test.info().project.use.baseURL, reducedMotion });
  const page = await context.newPage();
  await page.goto('/'); await page.getByRole('button', { name: /Start a new room/i }).click(); await page.waitForURL(/\/room\//);
  await page.getByLabel('Your name').fill('Maya'); await page.getByRole('button', { name: /Enter room/i }).click();
  await expect(page.getByText('Live')).toBeVisible();
  await page.getByRole('button', { name: /Things/ }).click(); // close the drawer: more table in view
  const bot = await joinAsBot(test.info().project.use.baseURL!, page.url().split('/room/')[1]);
  const cards = Array.from({ length: 150 }, (_, i) => `card-${i}`), dice = ['die-1', 'die-2', 'die-3', 'die-4'];
  for (const [i, id] of cards.entries()) await bot.run({ type: 'create', object: { ...objectBase(id, 110 + (i % 15) * 44, 90 + Math.floor(i / 15) * 52), type: 'card', rank: 'A23456789'[i % 9], suit: '♥', faceUp: true } as never });
  await bot.run({ type: 'create', object: playingDeck('deck', 760, 160) }); await bot.run({ type: 'create', object: playingDeck('deck-2', 760, 420) });
  for (const [i, id] of dice.entries()) await bot.run({ type: 'create', object: { ...objectBase(id, 120 + i * 90, 760), type: 'die', value: 1, rollNonce: 0, color: '#3974e8' } as never });
  await expect(page.locator('.mini-grid')).toBeVisible();
  if (slowdown > 1) { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown }); }
  return { page, bot, cards, dice, close: async () => { bot.close(); await context.close(); } };
}

async function measure(page: Page, run: () => Promise<void>): Promise<Stats> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __sampling: boolean }; w.__frames = []; w.__sampling = true;
    let last = performance.now(); const frame = (t: number) => { w.__frames.push(t - last); last = t; if (w.__sampling) requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  });
  await page.evaluate(() => { (window as unknown as { __manipadAnimations: string[] }).__manipadAnimations = []; });
  await run();
  await page.waitForTimeout(500); // the longest animation is 300 ms
  const played = await page.evaluate(() => (window as unknown as { __manipadAnimations?: string[] }).__manipadAnimations ?? []);
  const frames = (await page.evaluate(() => { const w = window as unknown as { __frames: number[]; __sampling: boolean }; w.__sampling = false; return w.__frames; })).slice(1).sort((a, b) => a - b);
  return { frames: frames.length, median: Math.round(frames[Math.floor(frames.length / 2)] ?? 0), p95: Math.round(frames[Math.floor(frames.length * 0.95)] ?? 0), max: Math.round(frames.at(-1) ?? 0), long: frames.filter((f) => f > 50).length,
    animated: played.filter((entry) => !entry.startsWith('skip-heavy')).length, cut: played.filter((entry) => entry.startsWith('skip-heavy')).length };
}

async function compare(browser: Browser, slowdown: number) {
  const results: Record<string, Record<'still' | 'animated', Stats>> = {};
  for (const motion of ['reduce', 'no-preference'] as const) {
    const table = await crowdedTable(browser, motion, slowdown);
    for (const [name, commands] of Object.entries(ACTIONS)) {
      (results[name] ??= {} as Record<'still' | 'animated', Stats>)[motion === 'reduce' ? 'still' : 'animated'] = await measure(table.page, async () => {
        for (const command of commands('deck', table.cards, table.dice)) { await table.bot.run(command); await table.page.waitForTimeout(80); }
      });
    }
    await table.close();
  }
  return results;
}
const format = (title: string, results: Record<string, Record<'still' | 'animated', Stats>>) => [title, ...Object.entries(results).map(([name, r]) =>
  `  ${name.padEnd(8)} still: median ${r.still.median} ms, p95 ${r.still.p95} ms, max ${r.still.max} ms, >50 ms ${r.still.long}/${r.still.frames}   animated: median ${r.animated.median} ms, p95 ${r.animated.p95} ms, max ${r.animated.max} ms, >50 ms ${r.animated.long}/${r.animated.frames} (${r.animated.animated} played, ${r.animated.cut} cut as too heavy)`)].join('\n');

test('animations keep the frame rate on a crowded table (tablet)', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'tablet', 'measured on the tablet profile');
  test.setTimeout(300_000);
  const webkit = await compare(browser, 1);
  const slow = await chromium.launch(); const chromiumResults = await compare(slow, 4); await slow.close();
  const report = `${format('WebKit, iPad profile', webkit)}\n${format('Chromium, iPad size, CPU 4x slower', chromiumResults)}`;
  console.log(report); await testInfo.attach('frame-times.txt', { body: report, contentType: 'text/plain' });
  // The rule is "if it stutters, cut it": on the tablet profile, an animation that does play on this crowded table must
  // keep most frames under 34 ms (30 fps); otherwise it should have been cut as too heavy (boardTooHeavyToAnimate).
  // Before that cut existed, a shuffle here drew 7 frames in about a second. Frame counts and p95 also move with the
  // board's own redraw after each change and with machine noise, so they are reported, not compared. The slowed-down
  // Chromium run is reported only.
  for (const [name, r] of Object.entries(webkit)) if (r.animated.animated > 0) expect(r.animated.median, `${name}: median frame time while animating`).toBeLessThanOrEqual(34);
});
