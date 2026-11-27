import { z } from 'zod';

const finite = z.number().finite();
const base = z.object({
  id: z.string().min(1).max(80), type: z.string(), x: finite, y: finite,
  rotation: finite, scaleX: finite, scaleY: finite, z: finite,
  locked: z.boolean(), creator: z.string().max(80), revision: z.number().int().nonnegative(),
}).passthrough();

const OBJECT_TYPES = ['stroke','text','shape','counter','numberTile','fractionBar','card','deck','die','pawn','chip','image','region'];
// Card codes are `${rank}${suitIndex}` or, for imported sets, `${setId}:${index}` (see cards.ts). Hidden cards arrive at
// clients with an empty rank / empty code / a custom code without its index, so rejecting those here stops a client from
// re-creating (duplicating) a card it cannot see.
const customCode = /^s\d{1,3}:\d{1,4}$/;
const cardCode = z.string().regex(/^\S{2,40}$/).refine((code) => !code.includes(':') || customCode.test(code));
const cardFields = z.object({ rank: z.string().max(39), suit: z.enum(['♠','♥','♦','♣']), faceUp: z.boolean(), face: z.string().regex(customCode).optional() })
  .refine((card) => (card.face ? card.rank === '' : card.rank.length > 0));
const deckFields = z.object({ cards: z.array(cardCode).max(500), initialCards: z.array(cardCode).max(500), faceUp: z.boolean() });
const regionFields = z.object({ width: finite.min(80).max(4000), height: finite.min(60).max(4000), ownerId: z.string().min(1).max(80) });

export const CARD_SET_LIMITS = { faces: 200, fields: 20, name: 60, text: 400, perRoom: 10 } as const;
export const cardSetSchema = z.object({
  name: z.string().trim().min(1).max(CARD_SET_LIMITS.name),
  widthMm: finite.min(10).max(500), heightMm: finite.min(10).max(500),
  faces: z.array(z.object({ fields: z.array(z.object({ name: z.string().max(CARD_SET_LIMITS.name), kind: z.enum(['text','icon','image']), text: z.string().max(CARD_SET_LIMITS.text) })).max(CARD_SET_LIMITS.fields) })).min(1).max(CARD_SET_LIMITS.faces),
});

export const boardObjectSchema = base.superRefine((value, ctx) => {
  if (!OBJECT_TYPES.includes(value.type)) { ctx.addIssue({ code: 'custom', message: 'Unknown object type' }); return; }
  const extra = value.type === 'card' ? cardFields : value.type === 'deck' ? deckFields : value.type === 'region' ? regionFields : undefined;
  if (extra && !extra.safeParse(value).success) ctx.addIssue({ code: 'custom', message: `Invalid ${value.type}` });
});

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), object: boardObjectSchema }),
  z.object({ type: z.literal('update'), ids: z.array(z.string()).max(100), patch: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('delete'), ids: z.array(z.string()).max(100) }),
  z.object({ type: z.literal('reorder'), ids: z.array(z.string()).max(100), direction: z.enum(['front','back']) }),
  z.object({ type: z.literal('clear') }), z.object({ type: z.literal('undo') }), z.object({ type: z.literal('redo') }),
  z.object({ type: z.literal('rollDie'), id: z.string() }), z.object({ type: z.literal('shuffleDeck'), id: z.string() }),
  z.object({ type: z.literal('drawCard'), id: z.string(), position: z.object({ x: finite, y: finite }).optional() }), z.object({ type: z.literal('drawAndFlip'), id: z.string() }), z.object({ type: z.literal('resetDeck'), id: z.string() }),
  z.object({ type: z.literal('flipDeck'), id: z.string() }),
  z.object({ type: z.literal('mergeIntoDeck'), sourceId: z.string(), targetId: z.string() }),
  z.object({ type: z.literal('flipCard'), id: z.string() }), z.object({ type: z.literal('flipChip'), id: z.string() }),
  // ownerName/color are filled in by the server from the participant list; clients cannot set them.
  z.object({ type: z.literal('assignRegion'), id: z.string(), ownerId: z.string().min(1).max(80) }),
  z.object({ type: z.literal('importDeck'), id: z.string().min(1).max(80), position: z.object({ x: finite, y: finite }), set: cardSetSchema }),
]);

export const joinSchema = z.object({
  roomId: z.string().regex(/^[a-z0-9-]{4,32}$/), participantId: z.string().min(4).max(80),
  // Proves ownership of participantId (which is public in the presence list) across reconnects.
  secret: z.string().min(16).max(100),
  name: z.string().trim().min(1).max(28), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  tutorToken: z.string().max(100).optional(), version: z.literal(1),
});
