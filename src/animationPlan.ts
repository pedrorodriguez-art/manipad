import type { BoardObject } from './shared/types';

export type Point = { x: number; y: number };
export type AnimationPlan = { id: string; kind: 'move' | 'draw' | 'flip' | 'shuffle'; from?: Point };
/** Above this many changes in one snapshot (opening a board, a big undo), nothing animates: it would only cost frames. */
export const MAX_ANIMATED_CHANGES = 30;

const faceUpOf = (o: BoardObject) => (o.type === 'card' || o.type === 'deck' ? o.faceUp : undefined);
const shuffleOf = (o: BoardObject) => (o.type === 'deck' ? o.shuffleNonce ?? 0 : 0);
const deckOfDrawn = (o: BoardObject) => (o.type === 'card' && o.creator.startsWith('deck:') ? o.creator.slice(5) : undefined);

/**
 * What to animate between two snapshots (see boardAnimations.ts). `shown` is where each object was last shown (a node
 * this person dragged is where it was dropped); `quietDecks` are decks this person just drew from by dragging.
 */
export function planAnimations(before: Map<string, BoardObject> | undefined, objects: BoardObject[], shown: Map<string, Point>, quietDecks: Set<string> = new Set()): AnimationPlan[] {
  if (!before) return [];
  const current = new Map(objects.map((o) => [o.id, o])), plans: AnimationPlan[] = [];
  for (const o of objects) {
    const old = before.get(o.id);
    if (!old) {
      const deckId = deckOfDrawn(o), deck = deckId ? current.get(deckId) ?? before.get(deckId) : undefined;
      if (deckId && deck && !quietDecks.has(deckId)) plans.push({ id: o.id, kind: 'draw', from: { x: deck.x, y: deck.y } });
      continue;
    }
    const from = shown.get(o.id) ?? { x: old.x, y: old.y };
    if ((old.x !== o.x || old.y !== o.y) && Math.hypot(from.x - o.x, from.y - o.y) > 2) plans.push({ id: o.id, kind: 'move', from });
    if (faceUpOf(o) !== faceUpOf(old)) plans.push({ id: o.id, kind: 'flip' });
    if (shuffleOf(o) > shuffleOf(old)) plans.push({ id: o.id, kind: 'shuffle' });
  }
  return plans.length > MAX_ANIMATED_CHANGES ? [] : plans;
}
