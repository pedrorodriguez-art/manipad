import type { BoardObject, CardObject, DeckObject } from '../src/shared/types.js';
import { handOf } from '../src/shared/regions.js';

/**
 * Builds the board as one participant is allowed to see it. Hidden information is removed, not just flagged,
 * because everything sent here is readable in the browser's devtools.
 *
 * - Face-down cards: rank/suit are blanked for everyone…
 * - …except cards in the viewer's own hand, which keep their face and get `peek: true`.
 * - Decks: the order is never sent (codes are blanked) except the top card of a face-up deck outside any hand.
 *   `initialCards` is never sent, since merging face-down cards into a deck appends their codes to it.
 */
export function projectObjects(objects: BoardObject[], viewerId: string): BoardObject[] {
  return objects.map((o): BoardObject => {
    if (o.type === 'card') return projectCard(objects, o, viewerId);
    if (o.type === 'deck') return projectDeck(objects, o);
    return structuredClone(o);
  });
}

export const HIDDEN_CARD = { rank: '', suit: '♠' } as const;

function projectCard(objects: BoardObject[], card: CardObject, viewerId: string): CardObject {
  const hand = handOf(objects, card);
  if (hand && hand.ownerId === viewerId) return { ...card, faceUp: false, peek: true };
  if (card.faceUp && !hand) return { ...card };
  return { ...card, ...HIDDEN_CARD, faceUp: false };
}

function projectDeck(objects: BoardObject[], deck: DeckObject): DeckObject {
  const showTop = deck.faceUp && !handOf(objects, deck);
  const cards = deck.cards.map((code, i) => showTop && i === deck.cards.length - 1 ? code : '');
  return { ...deck, cards, initialCards: [] };
}
