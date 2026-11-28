import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { BoardObject, CardSet } from '../src/shared/types.js';
import { boardObjectSchema, CARD_SET_LIMITS, ROOM_IMAGE_URL, storedCardSetSchema } from '../src/shared/schemas.js';
import { ASSET_REF, BOARD_FILE, checkBoardEnvelope } from '../src/shared/boardFile.js';
import { isCustomCode, setOfCode } from '../src/shared/cards.js';
import { normalizeHands } from '../src/shared/engine.js';
import { cardImageUrl, type Room } from './room-store.js';

type StoredImage = { type: string; data: Buffer };
export interface BoardFile { format: typeof BOARD_FILE.format; version: number; exportedAt: string; objects: BoardObject[]; cardSets: CardSet[]; assets: Record<string, { type: string; data: string }>; }
export type ParsedBoard = { ok: true; objects: BoardObject[]; cardSets: CardSet[]; images: Map<string, StoredImage> } | { ok: false; message: string };

/** Upgrades a file of version N to N+1. Empty while there is only version 1; add an entry whenever the format changes. */
const BOARD_FILE_MIGRATIONS: Record<number, (file: Record<string, unknown>) => Record<string, unknown>> = {};

const MAX_OBJECTS = 500;
const fileSchema = z.object({
  format: z.literal(BOARD_FILE.format), version: z.literal(BOARD_FILE.version), exportedAt: z.string().max(40).optional(),
  objects: z.array(z.unknown()).max(MAX_OBJECTS),
  cardSets: z.array(z.unknown()).max(CARD_SET_LIMITS.perRoom),
  assets: z.record(z.string().regex(/^[A-Za-z0-9_-]{16}$/), z.object({ type: z.enum(['image/png', 'image/jpeg', 'image/webp']), data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/) })),
});

/** Applies `fn` to every string inside a JSON value. */
function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, fn)]));
  return value;
}

/** Everything on the board, as the server keeps it, with the room's pictures embedded. Only the tutor may ask for it. */
export function exportBoard(room: Room): BoardFile {
  const used = new Set<string>();
  const toRef = (text: string) => { const match = ROOM_IMAGE_URL.exec(text); if (match && match[1] === room.id && room.cardImages.has(match[2])) { used.add(match[2]); return `asset:${match[2]}`; } return text; };
  const objects = mapStrings(room.objects, toRef) as BoardObject[], cardSets = mapStrings(room.cardSets, toRef) as CardSet[];
  const assets = Object.fromEntries([...used].map((token) => { const image = room.cardImages.get(token)!; return [token, { type: image.type, data: image.data.toString('base64') }]; }));
  return { format: BOARD_FILE.format, version: BOARD_FILE.version, exportedAt: new Date().toISOString(), objects, cardSets, assets };
}

/**
 * Checks a board file completely and prepares it for `room`, without changing the room: the envelope and version, every
 * object and card set against the same schemas the commands use, card codes against the sets, and picture references
 * against the embedded pictures (which get new tokens in this room).
 */
export function parseBoardFile(input: unknown, room: Room): ParsedBoard {
  const fail = (message: string): ParsedBoard => ({ ok: false, message });
  const early = checkBoardEnvelope(input); if (early) return fail(early);
  let file = input as Record<string, unknown>;
  for (let version = file.version as number; version < BOARD_FILE.version; version++) file = BOARD_FILE_MIGRATIONS[version](file);
  const parsed = fileSchema.safeParse(file);
  if (!parsed.success) { const issue = parsed.error.issues[0]; return fail(`That board file is damaged (${issue.path.join('.') || 'file'}: ${issue.message})`); }

  const images = new Map<string, StoredImage>(), tokens = new Map<string, string>(); let bytes = 0;
  for (const [token, asset] of Object.entries(parsed.data.assets)) {
    const data = Buffer.from(asset.data, 'base64'); bytes += data.length;
    const fresh = randomBytes(12).toString('base64url'); tokens.set(token, fresh); images.set(fresh, { type: asset.type, data });
  }
  if (bytes > CARD_SET_LIMITS.imageBytesPerRoom) return fail('That board has more pictures than a room can hold (30 MB)');
  let missing = '';
  const resolve = (text: string) => {
    const ref = ASSET_REF.exec(text); if (ref) { const fresh = tokens.get(ref[1]); if (!fresh) missing = ref[1]; return fresh ? cardImageUrl(room, fresh) : text; }
    // A picture address must be one of the pictures this file brings, never one from another room.
    if (ROOM_IMAGE_URL.test(text)) missing = text;
    return text;
  };
  const objects = mapStrings(parsed.data.objects, resolve) as unknown[], sets = mapStrings(parsed.data.cardSets, resolve) as unknown[];
  if (missing) return fail('That board file refers to a picture it does not contain');

  const cardSets: CardSet[] = [];
  for (const [i, raw] of sets.entries()) {
    const set = storedCardSetSchema.safeParse(raw);
    if (!set.success || set.data.id !== `s${i + 1}`) return fail(`That board file has an invalid card set (#${i + 1})`);
    cardSets.push(set.data as CardSet);
  }
  const ids = new Set<string>(), board: BoardObject[] = [];
  for (const [i, raw] of objects.entries()) {
    const object = boardObjectSchema.safeParse(raw);
    if (!object.success) return fail(`That board file has an invalid object (#${i + 1}${raw && typeof raw === 'object' && 'type' in raw ? `, ${String(raw.type).slice(0, 20)}` : ''})`);
    const o = object.data as unknown as BoardObject;
    if (o.type === 'card') delete o.peek; // only the server marks a card as peeked, per viewer
    if (ids.has(o.id)) return fail('That board file has two objects with the same id');
    ids.add(o.id);
    const codes = o.type === 'card' ? (o.face ? [o.face] : []) : o.type === 'deck' ? [...o.cards, ...o.initialCards] : [];
    for (const code of codes.filter(isCustomCode)) {
      const set = cardSets.find((s) => s.id === setOfCode(code)), index = Number(code.split(':')[1]);
      if (!set || !(index < set.faces.length)) return fail('That board file has a card from a deck it does not contain');
    }
    board.push(o);
  }
  const revision = room.revision + 1;
  return { ok: true, objects: normalizeHands(board, board, revision), cardSets, images };
}

/** Replaces the whole board. Not undoable: the history refers to pictures and card sets that are gone. */
export function applyBoardFile(room: Room, board: Extract<ParsedBoard, { ok: true }>) {
  room.objects = board.objects; room.cardSets = board.cardSets; room.cardImages = board.images;
  room.history = []; room.future = []; room.revision++;
}
