import type { CardObject, CardSet } from './types.js';

/**
 * Card codes, as stored in `DeckObject.cards`:
 * - playing cards: `${rank}${suitIndex}` (e.g. `K1` is the king of hearts);
 * - custom cards (imported sets): `${setId}:${index}`, pointing at `RoomSnapshot.cardSets[setId].faces[index]`.
 *
 * A hidden custom card keeps its set (`s1:`) so others still see its size and back, but never its index.
 */
export const SUITS = ['♠', '♥', '♦', '♣'] as const;
const CUSTOM = /^(s\d{1,3}):(\d{0,4})$/;

export const isCustomCode = (code: string) => CUSTOM.test(code);
/** The set of a custom code (visible or hidden), or undefined for playing cards. */
export const setOfCode = (code: string) => CUSTOM.exec(code)?.[1];
/** A full custom code with its index, i.e. one that reveals the face. */
export const isVisibleCustomCode = (code: string) => Boolean(CUSTOM.exec(code)?.[2]);
export const hiddenCode = (code: string) => { const set = setOfCode(code); return set ? `${set}:` : ''; };

export function cardFromCode(code: string): Pick<CardObject, 'rank' | 'suit'> & { face?: string } {
  if (isCustomCode(code)) return { rank: '', suit: '♠', face: code };
  return { rank: code.slice(0, -1), suit: SUITS[Number(code.slice(-1))] ?? '♠' };
}

export const codeOfCard = (card: CardObject) => card.face ?? `${card.rank}${SUITS.indexOf(card.suit)}`;

export function faceOf(sets: CardSet[], code: string | undefined) {
  const match = code ? CUSTOM.exec(code) : null; if (!match || !match[2]) return undefined;
  return sets.find((s) => s.id === match[1])?.faces[Number(match[2])];
}

/** Board size of a card (without the deck's count indicator). Custom cards keep their set's proportions at a readable size. */
export const PLAYING_CARD = { width: 68, height: 94 };
export const CUSTOM_CARD_HEIGHT = 150;
export function cardSize(sets: CardSet[], code: string | undefined) {
  const set = code ? sets.find((s) => s.id === setOfCode(code)) : undefined;
  if (!set) return code && isCustomCode(code) ? { width: Math.round(CUSTOM_CARD_HEIGHT * 63 / 88), height: CUSTOM_CARD_HEIGHT } : PLAYING_CARD;
  const ratio = Math.min(2, Math.max(0.4, set.widthMm / set.heightMm));
  return { width: Math.round(CUSTOM_CARD_HEIGHT * ratio), height: CUSTOM_CARD_HEIGHT };
}
