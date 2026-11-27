import { z } from 'zod';
import type { CardField, CardSet } from './types.js';
import { CARD_SET_LIMITS } from './schemas.js';

/**
 * Reads a collection exported by Naipe (https://luccoelho.github.io/TCC/), e.g. `example/naipe-*.json`:
 * `{ collection, blueprint: { name, width_mm, height_mm }, cards: [{ id, sort_order, fields: { [name]: { type, text, image_path } } }] }`.
 *
 * Field types seen so far: `texto`, `icone` (a Material Symbols name) and `imagem`. The export carries only a path for
 * images, not the file, so images cannot be imported yet; they are reported in `warnings`.
 */
const naipeField = z.object({ type: z.string(), text: z.string().nullish(), image_path: z.string().nullish() }).passthrough();
const naipeExport = z.object({
  collection: z.string(),
  blueprint: z.object({ name: z.string().optional(), width_mm: z.number().positive(), height_mm: z.number().positive() }).passthrough(),
  cards: z.array(z.object({ sort_order: z.number().optional(), fields: z.record(z.string(), naipeField) }).passthrough()).min(1),
}).passthrough();

const KINDS: Record<string, CardField['kind']> = { texto: 'text', icone: 'icon', imagem: 'image' };

export type NaipeImport = { set: Omit<CardSet, 'id'>; warnings: string[] };

export function parseNaipeExport(raw: unknown): NaipeImport {
  const parsed = naipeExport.safeParse(raw);
  if (!parsed.success) throw new Error('This file is not a Naipe export');
  const { collection, blueprint, cards } = parsed.data;
  if (cards.length > CARD_SET_LIMITS.faces) throw new Error(`A deck can have at most ${CARD_SET_LIMITS.faces} cards (this one has ${cards.length})`);
  const warnings: string[] = []; let images = 0, truncated = false;
  const clip = (text: string, max: number) => { if (text.length > max) truncated = true; return text.slice(0, max); };
  const ordered = cards.map((card, i) => ({ card, order: card.sort_order ?? i })).sort((a, b) => a.order - b.order);
  const faces = ordered.map(({ card }) => ({
    fields: Object.entries(card.fields).slice(0, CARD_SET_LIMITS.fields).map(([name, field]): CardField => {
      if (field.image_path) images++;
      return { name: clip(name, CARD_SET_LIMITS.name), kind: KINDS[field.type] ?? 'text', text: clip(field.text ?? '', CARD_SET_LIMITS.text) };
    }),
  }));
  if (images) warnings.push(`${images} image${images === 1 ? '' : 's'} could not be imported (Naipe exports only their paths)`);
  if (truncated) warnings.push('Some long texts were shortened');
  return { set: { name: clip(collection.trim() || 'Imported cards', CARD_SET_LIMITS.name), widthMm: blueprint.width_mm, heightMm: blueprint.height_mm, faces }, warnings };
}
