import type { BoardObject, CardObject, DeckObject, RegionObject } from './types.js';

/** Axis-aligned bounds of a region (regions cannot be rotated; scale comes from the resize handles). */
export function regionBounds(region: RegionObject) {
  const w = region.width * region.scaleX, h = region.height * region.scaleY;
  return { left: Math.min(region.x, region.x + w), top: Math.min(region.y, region.y + h), right: Math.max(region.x, region.x + w), bottom: Math.max(region.y, region.y + h) };
}

export function regionContains(region: RegionObject, point: { x: number; y: number }) {
  const b = regionBounds(region);
  return point.x >= b.left && point.x <= b.right && point.y >= b.top && point.y <= b.bottom;
}

/** Topmost region containing the point. */
export function regionAt(objects: BoardObject[], point: { x: number; y: number }): RegionObject | undefined {
  let found: RegionObject | undefined;
  for (const o of objects) if (o.type === 'region' && regionContains(o, point) && (!found || o.z >= found.z)) found = o;
  return found;
}

export const isPrivatizable = (o: BoardObject): o is CardObject | DeckObject => o.type === 'card' || o.type === 'deck';

/**
 * The hand a card or deck belongs to. Membership is explicit (`handId`, set by the engine when the object is moved or
 * drawn into a region), not purely geometric: creating or stretching a region over cards must not reveal them to its owner.
 */
export function handOf(objects: BoardObject[], o: BoardObject): RegionObject | undefined {
  if (!isPrivatizable(o) || !o.handId) return undefined;
  const region = objects.find((r): r is RegionObject => r.type === 'region' && r.id === o.handId);
  return region && regionContains(region, o) ? region : undefined;
}

export function regionsOverlap(a: RegionObject, b: RegionObject) {
  const p = regionBounds(a), q = regionBounds(b);
  return p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom;
}

/** Number of cards in a hand (a deck counts as all of its cards). */
export function handCount(objects: BoardObject[], region: RegionObject) {
  return objects.reduce((n, o) => n + (isPrivatizable(o) && handOf(objects, o)?.id === region.id ? (o.type === 'deck' ? o.cards.length : 1) : 0), 0);
}
