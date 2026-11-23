import { test, expect, type Page } from '@playwright/test';

/**
 * Records everything Socket.IO delivers to a page, i.e. what that participant could read in devtools:
 * WebSocket frames and the HTTP long-polling responses Socket.IO uses before upgrading.
 */
function recordFrames(page: Page) {
  const frames: string[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (frame) => { if (typeof frame.payload === 'string') frames.push(frame.payload); }));
  page.on('response', (response) => { if (response.url().includes('/socket.io/')) response.text().then((body) => frames.push(body), () => {}); });
  return frames;
}

async function join(page: Page, url: string, name: string) {
  await page.goto(url); await page.getByLabel('Your name').fill(name); await page.getByRole('button', { name: /Enter room/i }).click();
  await expect(page.getByText('Live')).toBeVisible();
}

const point = async (page: Page, selector: string) => page.locator(selector).first().evaluate((node) => ({ x: Number(node.getAttribute('data-x')), y: Number(node.getAttribute('data-y')) }));

test('a card in a hand is only visible to the owner, on screen and on the wire', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'drawing a card into a hand uses a mouse drag');
  const tutorContext = await browser.newContext(), studentContext = await browser.newContext();
  const maya = await tutorContext.newPage(), leo = await studentContext.newPage();
  const mayaFrames = recordFrames(maya);

  await maya.goto('/'); await maya.getByRole('button', { name: /Start a new room/i }).click(); await maya.waitForURL(/\/room\//);
  const url = maya.url(); await maya.getByLabel('Your name').fill('Maya'); await maya.getByRole('button', { name: /Enter room/i }).click();
  await join(leo, url, 'Leo');

  // Leo creates his hand and a deck, then drags the top card of the deck straight into his hand.
  await leo.getByRole('button', { name: /My hand/ }).click();
  await expect(maya.locator('.mini-grid i[data-type="region"][data-owner="Leo"]')).toHaveCount(1);
  await leo.getByRole('button', { name: /Card deck/ }).click();
  await expect(leo.locator('.mini-grid i[data-type="deck"]')).toHaveCount(1);
  const handCorner = await point(leo, '.mini-grid i[data-type="region"]'), deck = await point(leo, '.mini-grid i[data-type="deck"]');
  const canvas = leo.locator('canvas').first(); const box = (await canvas.boundingBox())!;
  await leo.mouse.move(box.x + deck.x, box.y + deck.y); await leo.mouse.down();
  await leo.mouse.move(box.x + handCorner.x + 220, box.y + handCorner.y + 90, { steps: 10 }); await leo.mouse.up();

  // Leo sees the face of his card.
  const leoCard = leo.locator('.mini-grid i[data-type="card"][data-hand="Leo"]');
  await expect(leoCard).toHaveCount(1);
  const face = (await leoCard.getAttribute('data-face'))!;
  expect(face).toMatch(/^(A|[2-9]|10|J|Q|K)[♠♥♦♣]$/);

  // Maya sees a card back in Leo's hand and the hand count, but not the face.
  await expect(maya.locator('.mini-grid i[data-type="card"][data-hand="Leo"]')).toHaveCount(1);
  await expect(maya.locator('.mini-grid i[data-type="card"][data-hand="Leo"]')).toHaveAttribute('data-face', '');
  await expect(maya.locator('.mini-grid i[data-type="region"][data-owner="Leo"]')).toHaveAttribute('data-count', '1');

  // Someone who joins later doesn't get it either.
  const lateContext = await browser.newContext(); const sam = await lateContext.newPage(); const samFrames = recordFrames(sam);
  await join(sam, url, 'Sam');
  await expect(sam.locator('.mini-grid i[data-type="card"][data-hand="Leo"]')).toHaveAttribute('data-face', '');

  // Nothing Maya or Sam received over the socket contains the card's face or the deck order.
  const rank = face.slice(0, -1), suit = face.slice(-1), code = `${rank}${['♠', '♥', '♦', '♣'].indexOf(suit)}`;
  for (const frames of [mayaFrames, samFrames]) {
    expect(frames.some((f) => f.includes('"snapshot"'))).toBe(true);
    const all = frames.join('\n');
    expect(all).not.toContain(`"rank":"${rank}","suit":"${suit}"`);
    expect(all).not.toContain(`"${code}"`);
    expect(all).not.toContain('"peek":true');
  }

  await tutorContext.close(); await studentContext.close(); await lateContext.close();
});

test('another participant cannot reuse your id to see your hand', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const leo = await a.newPage(), impostor = await b.newPage();
  await leo.goto('/'); await leo.getByRole('button', { name: /Start a new room/i }).click(); await leo.waitForURL(/\/room\//);
  const url = leo.url(); await leo.getByLabel('Your name').fill('Leo'); await leo.getByRole('button', { name: /Enter room/i }).click();
  await expect(leo.getByText('Live')).toBeVisible();
  const leoId = await leo.evaluate(() => JSON.parse(localStorage.getItem('manipad-profile')!).id as string);
  await impostor.goto('/');
  await impostor.evaluate((id) => localStorage.setItem('manipad-profile', JSON.stringify({ id, secret: 'not-leos-secret-123456', name: 'Leo', color: '#3974e8' })), leoId);
  await impostor.goto(url);
  await expect(impostor.getByText(/already in the room from another browser/)).toBeVisible();
  await a.close(); await b.close();
});
