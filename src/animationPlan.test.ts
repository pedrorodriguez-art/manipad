import { describe, expect, it } from 'vitest';
import { MAX_ANIMATED_CHANGES, planAnimations } from './animationPlan';
import type { BoardObject, CardObject, DeckObject } from './shared/types';

const base = (id: string, x = 0, y = 0) => ({ id, x, y, rotation: 0, scaleX: 1, scaleY: 1, z: 0, locked: false, creator: 'a', revision: 0 });
const card = (id: string, x = 0, y = 0, extra: Partial<CardObject> = {}): CardObject => ({ ...base(id, x, y), type: 'card', rank: 'A', suit: '♠', faceUp: false, ...extra });
const deck = (id: string, x = 0, y = 0, extra: Partial<DeckObject> = {}): DeckObject => ({ ...base(id, x, y), type: 'deck', cards: ['', ''], initialCards: [], faceUp: false, ...extra });
const map = (objects: BoardObject[]) => new Map(objects.map((o) => [o.id, o]));
const shownAt = (objects: BoardObject[]) => new Map(objects.map((o) => [o.id, { x: o.x, y: o.y }]));

describe('what animates between two snapshots', () => {
  it('nothing on the first snapshot', () => {
    expect(planAnimations(undefined, [card('a')], new Map())).toEqual([]);
  });

  it('a move made elsewhere glides from where the object was shown', () => {
    const before = [card('a', 0, 0)], after = [card('a', 300, 40)];
    expect(planAnimations(map(before), after, shownAt(before))).toEqual([{ id: 'a', kind: 'move', from: { x: 0, y: 0 } }]);
  });

  it('a move this person made by dragging does not replay', () => {
    const before = [card('a', 0, 0)], after = [card('a', 300, 40)];
    expect(planAnimations(map(before), after, new Map([['a', { x: 300, y: 40 }]]))).toEqual([]);
  });

  it('an object whose position did not change never moves, even if it was shown slightly off', () => {
    const objects = [deck('d', 100, 100)];
    expect(planAnimations(map(objects), objects, new Map([['d', { x: 104, y: 103 }]]))).toEqual([]);
  });

  it('a card drawn from a deck flies out of the deck, unless this person dragged it out', () => {
    const before = [deck('d', 50, 60, { cards: ['', '', ''] })], after = [deck('d', 50, 60), card('c', 200, 60, { creator: 'deck:d' })];
    expect(planAnimations(map(before), after, shownAt(before))).toEqual([{ id: 'c', kind: 'draw', from: { x: 50, y: 60 } }]);
    expect(planAnimations(map(before), after, shownAt(before), new Set(['d']))).toEqual([]);
    // The last card of a deck becomes a card with the deck's id; the one drawn before it still flies from there.
    const last = [card('d', 50, 60), card('c', 200, 60, { creator: 'deck:d' })];
    expect(planAnimations(map(before), last, shownAt(before)).map((p) => p.kind)).toEqual(['draw']);
  });

  it('new objects that were not drawn appear without flying', () => {
    expect(planAnimations(map([]), [card('new', 10, 10)], new Map())).toEqual([]);
  });

  it('cards and decks turning over flip; a shuffle shakes the deck', () => {
    const before = [card('a'), deck('d', 0, 0, { shuffleNonce: 2 })];
    const after = [card('a', 0, 0, { faceUp: true }), deck('d', 0, 0, { shuffleNonce: 3 })];
    expect(planAnimations(map(before), after, shownAt(before))).toEqual([{ id: 'a', kind: 'flip' }, { id: 'd', kind: 'shuffle' }]);
    // Undo brings an older shuffle count back: that is not a shuffle.
    expect(planAnimations(map(after), before, shownAt(after)).map((p) => p.kind)).toEqual(['flip']);
  });

  it('nothing animates when too many things change at once', () => {
    const before = Array.from({ length: MAX_ANIMATED_CHANGES + 1 }, (_, i) => card(`c${i}`, i, 0));
    const after = before.map((o) => ({ ...o, y: 500 }));
    expect(planAnimations(map(before), after, shownAt(before))).toEqual([]);
    expect(planAnimations(map(before), after.slice(0, MAX_ANIMATED_CHANGES).concat(before.slice(MAX_ANIMATED_CHANGES)), shownAt(before))).toHaveLength(MAX_ANIMATED_CHANGES);
  });
});
