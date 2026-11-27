import { beforeEach, describe, expect, it } from 'vitest';
import { RoomStore, type Room } from './room-store';
import { commandSchema, CARD_SET_LIMITS } from '../src/shared/schemas';
import { orderImageFiles, imageDeckName } from '../src/imageDeck';
import type { CardSet, DeckObject } from '../src/shared/types';

const leo = 'leo-participant';
const png = (bytes: number[]) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
const imageSet = (count = 2, image = (i: number) => png([137, 80, 78, 71, i])): Omit<CardSet, 'id'> => ({
  name: 'Images (2)', widthMm: 63, heightMm: 88,
  faces: Array.from({ length: count }, (_, i) => ({ fields: [{ name: 'File', kind: 'text', text: `card ${i + 1}` }], image: image(i) })),
});
let store: RoomStore; let room: Room;
const importImages = (set = imageSet(), id = 'images') => store.command(room, { type: 'importDeck', id, position: { x: 0, y: 0 }, set }, leo, false);

beforeEach(() => {
  store = new RoomStore(); room = store.create();
  room.participants.set(leo, { id: leo, name: 'Leo', color: '#e85c62', isTutor: false, selection: [] });
});

describe('decks made from image files', () => {
  it('orders files by name, numbers included, and names the deck', () => {
    expect(orderImageFiles([{ name: 'card 10.png' }, { name: 'card 2.png' }, { name: 'Card 1.png' }]).map((f) => f.name)).toEqual(['Card 1.png', 'card 2.png', 'card 10.png']);
    expect(imageDeckName([{ name: 'dragon.jpg' }])).toBe('dragon');
    expect(imageDeckName([{ name: 'a.png' }, { name: 'b.png' }])).toBe('Images (2)');
  });

  it('accepts only raster data URLs as card images', () => {
    const valid = (image: string) => commandSchema.safeParse({ type: 'importDeck', id: 'd', position: { x: 0, y: 0 }, set: imageSet(1, () => image) }).success;
    expect(valid(png([1, 2, 3]))).toBe(true);
    expect(valid('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(valid('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(valid('https://example.com/card.png')).toBe(false);
    expect(valid('/api/rooms/x/card-images/abc')).toBe(false);
    expect(valid(`data:image/png;base64,${'A'.repeat(CARD_SET_LIMITS.imageChars)}`)).toBe(false);
  });

  it('keeps the bytes on the server and sends only a URL in snapshots', () => {
    expect(importImages().ok).toBe(true);
    expect((room.objects[0] as DeckObject).cards).toEqual(['s1:1', 's1:0']);
    const snapshot = store.snapshotFor(room, leo);
    expect(JSON.stringify(snapshot)).not.toMatch(/base64/);
    const urls = snapshot.cardSets[0].faces.map((f) => f.image!);
    expect(urls[0].startsWith(`/api/rooms/${room.id}/card-images/`)).toBe(true); expect(urls[0].split("/").pop()).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(new Set(urls).size).toBe(2);
    const stored = room.cardImages.get(urls[1].split('/').pop()!)!;
    expect(stored.type).toBe('image/png'); expect([...stored.data]).toEqual([137, 80, 78, 71, 1]);
  });

  it('does not store images when the import is refused, and limits image bytes per room', () => {
    room.locked = true; expect(importImages().ok).toBe(false); expect(room.cardImages.size).toBe(0);
    room.locked = false;
    const big = (i: number) => `data:image/jpeg;base64,${Buffer.alloc(290_000, i).toString('base64')}`;
    let imported = 0; while (importImages(imageSet(25, big), `d${imported}`).ok) imported++;
    expect(imported).toBe(4); // 25 × 290 KB = 7.25 MB per deck; the 5th would pass 30 MB
    expect(importImages(imageSet(25, big), 'one-more')).toEqual({ ok: false, message: 'This room has no space left for more card images' });
    expect(room.cardSets).toHaveLength(4);
  });
});
