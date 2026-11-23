import { beforeEach, describe, expect, it } from 'vitest';
import { RoomStore, type Room } from './room-store';
import { projectObjects } from './visibility';
import type { BoardObject, CardObject, DeckObject, RegionObject } from '../src/shared/types';

const base = { rotation: 0, scaleX: 1, scaleY: 1, z: 0, locked: false, creator: 'x', revision: 0 };
const card = (id: string, x: number, y: number, rank = 'K', faceUp = false): CardObject => ({ ...base, id, type: 'card', x, y, rank, suit: '♥', faceUp });
const deck = (id: string, x: number, y: number, cards: string[], faceUp = false): DeckObject => ({ ...base, id, type: 'deck', x, y, cards, initialCards: [...cards], faceUp });
const hand = (id: string, ownerId: string, x = 0, y = 0): RegionObject => ({ ...base, id, type: 'region', x, y, width: 400, height: 160, ownerId, ownerName: ownerId, color: '#3974e8' });

const leo = 'leo-participant', maya = 'maya-participant', tutor = 'tutor-participant';
let store: RoomStore; let room: Room;
const find = <T extends BoardObject>(id: string) => room.objects.find((o) => o.id === id) as T;
const run = (actor: string, command: Parameters<RoomStore['command']>[1]) => store.command(room, command, actor, actor === tutor);

beforeEach(() => {
  store = new RoomStore(); room = store.create();
  for (const [id, name, isTutor] of [[leo, 'Leo', false], [maya, 'Maya', false], [tutor, 'Ana', true]] as const) room.participants.set(id, { id, name, color: '#e85c62', isTutor, selection: [] });
  expect(run(leo, { type: 'create', object: hand('leo-hand', leo) }).ok).toBe(true);
});

describe('state filtering per participant', () => {
  it('sends the face of a card in a hand only to its owner', () => {
    run(maya, { type: 'create', object: card('c1', 900, 900, 'Q', true) });
    expect(run(maya, { type: 'update', ids: ['c1'], patch: { x: 100, y: 80 } }).ok).toBe(true); // Maya gives Leo a card
    const forLeo = store.snapshotFor(room, leo).objects.find((o) => o.id === 'c1') as CardObject;
    const forMaya = store.snapshotFor(room, maya).objects.find((o) => o.id === 'c1') as CardObject;
    const forTutor = store.snapshotFor(room, tutor).objects.find((o) => o.id === 'c1') as CardObject;
    expect(forLeo).toMatchObject({ rank: 'Q', suit: '♥', faceUp: false, peek: true });
    for (const other of [forMaya, forTutor]) { expect(other).toMatchObject({ rank: '', faceUp: false }); expect(other.peek).toBeUndefined(); }
    expect(JSON.stringify(store.snapshotFor(room, maya))).not.toContain('"Q"');
  });

  it('hides face-down cards on the table and the order of every deck from everyone', () => {
    const objects: BoardObject[] = [card('down', 900, 900, 'A', false), card('up', 1000, 900, '7', true), deck('d', 1200, 900, ['A0', 'Q2', 'K1']), deck('open', 1400, 900, ['20', '31'], true)];
    const seen = projectObjects(objects, leo);
    expect(seen[0]).toMatchObject({ rank: '', faceUp: false });
    expect(seen[1]).toMatchObject({ rank: '7', faceUp: true });
    expect(seen[2]).toMatchObject({ cards: ['', '', ''], initialCards: [] });
    expect(seen[3]).toMatchObject({ cards: ['', '31'], initialCards: [] }); // only the visible top card of a face-up deck
    expect(objects[2]).toMatchObject({ cards: ['A0', 'Q2', 'K1'] }); // the stored state is untouched
  });

  it('shows the hand count to everyone through the card backs', () => {
    run(leo, { type: 'create', object: deck('d', 900, 900, ['A0', 'Q2', 'K1']) });
    run(leo, { type: 'drawCard', id: 'd', position: { x: 50, y: 50 } });
    run(leo, { type: 'drawCard', id: 'd', position: { x: 150, y: 50 } });
    const inHand = store.snapshotFor(room, maya).objects.filter((o) => o.type === 'card' && o.handId === 'leo-hand');
    expect(inHand).toHaveLength(2);
    expect(inHand.every((o) => o.type === 'card' && o.rank === '')).toBe(true);
  });
});

describe('cards entering and leaving a hand', () => {
  it('turns a card face down when it enters a hand and keeps it face down when it leaves', () => {
    run(leo, { type: 'create', object: card('c1', 900, 900, 'Q', true) });
    run(leo, { type: 'update', ids: ['c1'], patch: { x: 100, y: 80 } });
    expect(find<CardObject>('c1')).toMatchObject({ faceUp: false, handId: 'leo-hand' });
    expect(run(leo, { type: 'update', ids: ['c1'], patch: { x: 900, y: 900 } }).ok).toBe(true);
    expect(find<CardObject>('c1').faceUp).toBe(false);
    expect(find<CardObject>('c1').handId).toBeUndefined();
  });

  it('draws a card straight into a hand face down even from a face-up deck', () => {
    run(maya, { type: 'create', object: deck('d', 900, 900, ['A0', 'Q2', 'K1'], true) });
    run(maya, { type: 'drawCard', id: 'd', position: { x: 60, y: 60 } });
    const drawn = room.objects.find((o) => o.type === 'card') as CardObject;
    expect(drawn).toMatchObject({ handId: 'leo-hand', faceUp: false });
  });

  it('does not let anyone peek by creating or stretching a hand over face-down cards', () => {
    run(maya, { type: 'create', object: card('table', 700, 80, 'J', false) });
    expect(run(maya, { type: 'create', object: hand('maya-hand', maya, 600, 0) }).ok).toBe(true);
    expect(find<CardObject>('table').handId).toBeUndefined();
    expect((store.snapshotFor(room, maya).objects.find((o) => o.id === 'table') as CardObject).rank).toBe('');
  });

  it('carries the cards when the owner moves the hand', () => {
    run(leo, { type: 'create', object: card('c1', 900, 900) }); run(leo, { type: 'update', ids: ['c1'], patch: { x: 100, y: 80 } });
    expect(run(leo, { type: 'update', ids: ['leo-hand'], patch: { x: 0, y: 500 } }).ok).toBe(true);
    expect(find<CardObject>('c1')).toMatchObject({ x: 100, y: 580, handId: 'leo-hand' });
  });

  it('leaves cards face down when the hand is deleted', () => {
    run(leo, { type: 'create', object: card('c1', 900, 900, 'Q', true) }); run(leo, { type: 'update', ids: ['c1'], patch: { x: 100, y: 80 } });
    expect(run(leo, { type: 'delete', ids: ['leo-hand'] }).ok).toBe(true);
    expect(find<CardObject>('c1')).toMatchObject({ faceUp: false });
    expect(find<CardObject>('c1').handId).toBeUndefined();
    expect((store.snapshotFor(room, leo).objects.find((o) => o.id === 'c1') as CardObject).rank).toBe('');
  });

  it('keeps the hand private after its owner leaves and shows it again when they come back', () => {
    run(leo, { type: 'create', object: card('c1', 900, 900, 'Q', true) }); run(leo, { type: 'update', ids: ['c1'], patch: { x: 100, y: 80 } });
    room.participants.delete(leo);
    expect((store.snapshotFor(room, maya).objects.find((o) => o.id === 'c1') as CardObject).rank).toBe('');
    expect(find<RegionObject>('leo-hand')).toBeDefined();
    expect((store.snapshotFor(room, leo).objects.find((o) => o.id === 'c1') as CardObject).rank).toBe('Q');
  });
});

describe('hand permissions', () => {
  beforeEach(() => { run(leo, { type: 'create', object: card('c1', 900, 900, 'Q', true) }); run(leo, { type: 'update', ids: ['c1'], patch: { x: 100, y: 80 } }); });

  it('lets only the owner or the tutor take, flip or delete cards in a hand', () => {
    expect(run(maya, { type: 'update', ids: ['c1'], patch: { x: 900, y: 900 } })).toMatchObject({ ok: false, message: expect.stringContaining("Leo's hand") });
    expect(run(maya, { type: 'delete', ids: ['c1'] }).ok).toBe(false);
    expect(run(leo, { type: 'flipCard', id: 'c1' }).ok).toBe(false); // cards in a hand always stay face down
    expect(run(tutor, { type: 'update', ids: ['c1'], patch: { x: 900, y: 900 } }).ok).toBe(true);
    expect(find<CardObject>('c1').faceUp).toBe(false);
  });

  it('lets only the owner or the tutor move, resize or delete a hand', () => {
    expect(run(maya, { type: 'update', ids: ['leo-hand'], patch: { x: 50 } }).ok).toBe(false);
    expect(run(maya, { type: 'delete', ids: ['leo-hand'] }).ok).toBe(false);
    expect(run(leo, { type: 'update', ids: ['leo-hand'], patch: { width: 500 } }).ok).toBe(true);
    expect(run(tutor, { type: 'update', ids: ['leo-hand'], patch: { x: 20 } }).ok).toBe(true);
  });

  it('only lets you create your own hand, one per person, never overlapping another', () => {
    expect(run(maya, { type: 'create', object: hand('fake', leo, 0, 600) }).ok).toBe(false);
    expect(run(leo, { type: 'create', object: hand('second', leo, 0, 600) }).ok).toBe(false);
    expect(run(maya, { type: 'create', object: hand('maya-hand', maya, 100, 100) }).ok).toBe(false);
    expect(run(maya, { type: 'create', object: hand('maya-hand', maya, 0, 600) }).ok).toBe(true);
    expect(run(maya, { type: 'update', ids: ['maya-hand'], patch: { y: 50 } }).ok).toBe(false);
    expect(run(tutor, { type: 'create', object: hand('tutor-made', tutor, 0, 1200) }).ok).toBe(true);
  });

  it('fills the owner name and color from the participant list, not from the client', () => {
    run(maya, { type: 'create', object: { ...hand('maya-hand', maya, 0, 600), ownerName: 'Somebody else', color: '#000000' } });
    expect(find<RegionObject>('maya-hand')).toMatchObject({ ownerName: 'Maya', color: '#e85c62' });
  });

  it('only lets the tutor reassign a hand, and only when it is empty', () => {
    expect(run(leo, { type: 'assignRegion', id: 'leo-hand', ownerId: maya }).ok).toBe(false);
    expect(run(tutor, { type: 'assignRegion', id: 'leo-hand', ownerId: maya })).toMatchObject({ ok: false, message: expect.stringContaining('Empty') });
    run(tutor, { type: 'update', ids: ['c1'], patch: { x: 900, y: 900 } });
    expect(run(tutor, { type: 'assignRegion', id: 'leo-hand', ownerId: maya }).ok).toBe(true);
    expect(find<RegionObject>('leo-hand')).toMatchObject({ ownerId: maya, ownerName: 'Maya' });
  });

  it('does not let a generic update reveal or rewrite a card', () => {
    run(maya, { type: 'create', object: card('table', 900, 900, 'J', false) });
    run(maya, { type: 'update', ids: ['table', 'c1'], patch: { faceUp: true, rank: 'A', handId: undefined } });
    expect(find<CardObject>('table')).toMatchObject({ faceUp: false, rank: 'J' });
  });

  it('does not stack cards inside a hand', () => {
    run(leo, { type: 'create', object: card('c2', 900, 900) }); run(leo, { type: 'update', ids: ['c2'], patch: { x: 120, y: 80 } });
    expect(run(leo, { type: 'mergeIntoDeck', sourceId: 'c2', targetId: 'c1' }).ok).toBe(false);
  });

  it('lets the owner return a card from the hand to a deck on the table', () => {
    run(maya, { type: 'create', object: deck('d', 900, 900, ['A0', '20']) });
    expect(run(maya, { type: 'mergeIntoDeck', sourceId: 'c1', targetId: 'd' }).ok).toBe(false);
    expect(run(leo, { type: 'mergeIntoDeck', sourceId: 'c1', targetId: 'd' }).ok).toBe(true);
  });
});

describe('participant identity', () => {
  it('does not let someone reuse another participant id without its secret', () => {
    expect(store.claim(room, 'p-1', 'secret-one-1234567890')).toBe(true);
    expect(store.claim(room, 'p-1', 'secret-one-1234567890')).toBe(true);
    expect(store.claim(room, 'p-1', 'a-different-secret-123')).toBe(false);
  });
});
