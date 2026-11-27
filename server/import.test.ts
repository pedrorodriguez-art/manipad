import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { RoomStore, type Room } from './room-store';
import { parseNaipeExport } from '../src/shared/naipe';
import { commandSchema } from '../src/shared/schemas';
import { cardSize, faceOf } from '../src/shared/cards';
import type { BoardObject, CardObject, DeckObject, RegionObject } from '../src/shared/types';

const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '../example');
const example = JSON.parse(readFileSync(join(exampleDir, readdirSync(exampleDir).find((f) => f.startsWith('naipe-'))!), 'utf8'));

const leo = 'leo-participant', maya = 'maya-participant';
let store: RoomStore; let room: Room;
const run = (actor: string, command: Parameters<RoomStore['command']>[1]) => store.command(room, command, actor, false);
const find = <T extends BoardObject>(id: string) => room.objects.find((o) => o.id === id) as T;
const importExample = (id = 'naipe') => run(leo, { type: 'importDeck', id, position: { x: 900, y: 900 }, set: parseNaipeExport(example).set });

beforeEach(() => {
  store = new RoomStore(); room = store.create();
  for (const [id, name] of [[leo, 'Leo'], [maya, 'Maya']] as const) room.participants.set(id, { id, name, color: '#e85c62', isTutor: false, selection: [] });
});

describe('Naipe export parser', () => {
  it('reads the example export in sort order, keeping field order and kinds', () => {
    const { set, warnings } = parseNaipeExport(example);
    expect(set).toMatchObject({ name: 'Set de demonstração', widthMm: 63, heightMm: 88 });
    expect(set.faces).toHaveLength(3);
    expect(set.faces[0].fields.map((f) => f.name)).toEqual(['Nome', 'Símbolo', 'Arte', 'Custo', 'Tipo', 'Texto', 'Poder']);
    expect(set.faces[0].fields.slice(0, 3)).toEqual([
      { name: 'Nome', kind: 'text', text: 'Guardiã da Bruma' }, { name: 'Símbolo', kind: 'icon', text: 'auto_awesome' }, { name: 'Arte', kind: 'image', text: '' },
    ]);
    expect(set.faces.map((f) => f.fields[0].text)).toEqual(['Guardiã da Bruma', 'Farol Submerso', 'Corvo de Cinzas']);
    expect(warnings).toEqual([]);
    expect(commandSchema.safeParse({ type: 'importDeck', id: 'd', position: { x: 0, y: 0 }, set }).success).toBe(true);
  });

  it('warns about images it cannot bring along and rejects other files', () => {
    const withImage = structuredClone(example); withImage.cards[0].fields.Arte.image_path = 'images/guardia.png';
    expect(parseNaipeExport(withImage).warnings[0]).toMatch(/1 image could not be imported/);
    expect(() => parseNaipeExport({ hello: 'world' })).toThrow(/not a Naipe export/);
  });

  it('keeps the proportions of the blueprint', () => {
    const { set } = parseNaipeExport(example);
    expect(cardSize([{ ...set, id: 's1' }], 's1:0')).toEqual({ width: 107, height: 150 });
  });
});

describe('importing a deck into a room', () => {
  it('registers the set and places a face-down deck with the first card on top', () => {
    expect(importExample().ok).toBe(true);
    expect(room.cardSets.map((s) => s.id)).toEqual(['s1']);
    expect(find<DeckObject>('naipe')).toMatchObject({ type: 'deck', cards: ['s1:2', 's1:1', 's1:0'], faceUp: false, creator: leo });
    expect(run(leo, { type: 'drawAndFlip', id: 'naipe' }).ok).toBe(true);
    const drawn = room.objects.find((o): o is CardObject => o.type === 'card')!;
    expect(drawn).toMatchObject({ face: 's1:0', rank: '', faceUp: true });
    expect(faceOf(room.cardSets, drawn.face)?.fields[0].text).toBe('Guardiã da Bruma');
  });

  it('never sends the index of a hidden imported card, in decks, on the table or in a hand', () => {
    importExample();
    const theirHand: RegionObject = { id: 'maya-hand', type: 'region', x: 0, y: 0, width: 400, height: 200, rotation: 0, scaleX: 1, scaleY: 1, z: 0, locked: false, creator: maya, revision: 0, ownerId: maya, ownerName: 'Maya', color: '#3974e8' };
    run(maya, { type: 'create', object: theirHand });
    run(leo, { type: 'drawCard', id: 'naipe', position: { x: 100, y: 100 } }); // Leo deals Maya the top card
    const forLeo = store.snapshotFor(room, leo), forMaya = store.snapshotFor(room, maya);
    const dealt = (s: typeof forLeo) => s.objects.find((o): o is CardObject => o.type === 'card')!;
    expect(dealt(forMaya)).toMatchObject({ face: 's1:0', peek: true });
    expect(dealt(forLeo)).toMatchObject({ face: 's1:', rank: '' });
    expect(forLeo.objects.find((o): o is DeckObject => o.type === 'deck')!.cards).toEqual(['s1:', 's1:']);
    expect(JSON.stringify(forLeo.objects)).not.toMatch(/s1:\d/);
    expect(forLeo.cardSets[0].faces).toHaveLength(3); // the faces themselves are public, like knowing what a deck contains
  });

  it('does not let a client re-create a hidden imported card', () => {
    const base = { id: 'x', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, z: 0, locked: false, creator: '', revision: 0 };
    const create = (object: object) => commandSchema.safeParse({ type: 'create', object }).success;
    expect(create({ ...base, type: 'card', rank: '', suit: '♠', faceUp: false, face: 's1:' })).toBe(false);
    expect(create({ ...base, type: 'card', rank: '', suit: '♠', faceUp: true, face: 's1:0' })).toBe(true);
    expect(create({ ...base, type: 'deck', cards: ['s1:', 's1:'], initialCards: [], faceUp: false })).toBe(false);
  });

  it('keeps the set when the import is undone, and limits sets per room', () => {
    importExample(); expect(run(leo, { type: 'undo' }).ok).toBe(true);
    expect(room.objects).toEqual([]); expect(room.cardSets).toHaveLength(1);
    for (let i = 2; i <= 10; i++) expect(importExample(`d${i}`).ok).toBe(true);
    expect(importExample('one-too-many')).toEqual({ ok: false, message: 'A room can have at most 10 imported decks' });
  });

  it('respects the board lock', () => {
    room.locked = true;
    expect(importExample().ok).toBe(false); expect(room.cardSets).toEqual([]);
  });
});
