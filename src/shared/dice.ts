import type { DieObject } from './types.js';

/**
 * Dice have 2 to 20 faces; a die without `sides` is the classic d6 drawn with pips. Faces can carry a short text or a
 * picture (stored by the server, like card images: see D-010); a face with neither shows its number.
 */
export const DIE_LIMITS = { minSides: 2, maxSides: 20, text: 12, imageChars: 150_000, rollAtOnce: 50 } as const;
/** Board size of a die, and the size (3×) its face pictures are made at. */
export const DIE_SIZE = 70;
export const DIE_IMAGE_SIZE = DIE_SIZE * 3;

export const dieSides = (die: Pick<DieObject, 'sides'>) => die.sides ?? 6;
export const isClassicDie = (die: Pick<DieObject, 'sides' | 'faces'>) => dieSides(die) === 6 && !die.faces?.length;
/** A uniformly random face, 1..sides. Only the server rolls (see `applyCommand`). */
export const rollFace = (die: Pick<DieObject, 'sides'>) => 1 + Math.floor(Math.random() * dieSides(die));

/** What a face shows, as text: its picture (`img:<url>`), its text, or its number. Used for labels and tests. */
export function dieFaceLabel(die: Pick<DieObject, 'faces'>, value: number) {
  const face = die.faces?.[value - 1];
  if (face?.image) return `img:${face.image}`;
  return face?.text || String(value);
}
