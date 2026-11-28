import { beforeEach, describe, expect, it } from 'vitest';
import { RoomStore, type Room } from './room-store';
import { applyBoardFile, exportBoard, parseBoardFile, type BoardFile } from './board-file';
import { BOARD_FILE, precheckBoardFile } from '../src/shared/boardFile';
import type { BoardCommand, BoardObject, CardObject, DeckObject, DieObject, RegionObject } from '../src/shared/types';

const leo = 'leo-participant', tutor = 'tutor-participant';
const png = (seed: number) => `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, seed, seed]).toString('base64')}`;
const base = (id: string, x = 0, y = 0) => ({ id, x, y, rotation: 0, scaleX: 1, scaleY: 1, z: 0, locked: false, creator: tutor, revision: 0 });
let store: RoomStore; let source: Room; let target: Room;
const run = (room: Room, command: BoardCommand, actor = tutor) => { const result = store.command(room, command, actor, actor === tutor); expect(result).toEqual({ ok: true }); };
const roundTrip = (file: unknown, room = target) => parseBoardFile(JSON.parse(JSON.stringify(file)), room);
/** Picture addresses differ between rooms; compare boards with each address replaced by the bytes it serves. */
const withBytes = (room: Room) => JSON.parse(JSON.stringify({ objects: room.objects, cardSets: room.cardSets }).replace(/\/api\/rooms\/[a-z0-9-]+\/card-images\/([A-Za-z0-9_-]{16})/g, (_, token) => `bytes:${room.cardImages.get(token)!.data.toString('base64')}`));

beforeEach(() => {
  store = new RoomStore(); source = store.create(); target = store.create();
  for (const room of [source, target]) for (const [id, name] of [[leo, 'Leo'], [tutor, 'Tutor']]) room.participants.set(id, { id, name, color: '#e85c62', isTutor: id === tutor, selection: [] });
  // A playing deck (its order is never sent to players), a face-up card, a card in Leo's hand, an image deck, a die with a
  // picture face, a pasted image and a stroke.
  const cards = ['A0', 'K1', 'Q2', '73'];
  run(source, { type: 'create', object: { ...base('deck', 100, 100), type: 'deck', cards, initialCards: [...cards], faceUp: false } as DeckObject });
  run(source, { type: 'shuffleDeck', id: 'deck' });
  run(source, { type: 'drawAndFlip', id: 'deck' });
  run(source, { type: 'create', object: { ...base('hand', 0, 400), type: 'region', width: 440, height: 180, ownerId: leo, ownerName: 'Leo', color: '#e85c62' } as RegionObject }, leo);
  run(source, { type: 'drawCard', id: 'deck', position: { x: 200, y: 480 } }, leo);
  run(source, { type: 'importDeck', id: 'images', position: { x: 400, y: 100 }, set: { name: 'Images (2)', widthMm: 63, heightMm: 88, faces: [{ fields: [], image: png(1) }, { fields: [], image: png(2) }] } });
  run(source, { type: 'create', object: { ...base('die', 600, 100), type: 'die', value: 1, rollNonce: 0, color: '#3974e8', sides: 2, faces: [{ image: png(3) }, { text: 'B' }] } as DieObject });
  run(source, { type: 'create', object: { ...base('pasted', 700, 300), type: 'image', src: png(4), width: 80, height: 80, alt: 'pasted' } as BoardObject });
  run(source, { type: 'create', object: { ...base('ink'), type: 'stroke', points: [0, 0, 10, 10], color: '#000000', width: 4, opacity: 1 } as BoardObject });
});

describe('board files', () => {
  it('saves and reopens the whole board, hidden cards, deck order and pictures included', () => {
    const file = exportBoard(source);
    expect(file).toMatchObject({ format: 'manipad-board', version: BOARD_FILE.version });
    expect(Object.keys(file.assets)).toHaveLength(3); // two deck cards and one die face
    expect(JSON.stringify(file)).not.toContain('/api/rooms/'); // self-contained: no address of the source room

    run(target, { type: 'create', object: { ...base('old'), type: 'counter', color: '#3974e8', size: 54 } as BoardObject });
    const board = roundTrip(file); expect(board.ok).toBe(true); if (!board.ok) return;
    applyBoardFile(target, board);
    expect(withBytes(target)).toEqual(withBytes(source));
    expect((target.objects.find((o) => o.id === 'deck') as DeckObject).cards).toEqual((source.objects.find((o) => o.id === 'deck') as DeckObject).cards);
    const inHand = target.objects.find((o): o is CardObject => o.type === 'card' && Boolean(o.handId))!;
    expect(inHand.handId).toBe('hand');
    // Privacy still holds after opening: Leo's card stays hidden from the tutor's snapshot, the deck order from everyone.
    const seenByTutor = store.snapshotFor(target, tutor).objects;
    expect(seenByTutor.find((o) => o.id === inHand.id)).toMatchObject({ rank: '', faceUp: false });
    expect((seenByTutor.find((o) => o.id === 'deck') as DeckObject).cards.every((code) => code === '')).toBe(true);
    // Pictures got new addresses in this room.
    const die = target.objects.find((o) => o.id === 'die') as DieObject;
    expect(die.faces![0].image).toMatch(new RegExp(`^/api/rooms/${target.id}/card-images/`));
    expect(target.cardImages.size).toBe(3);
  });

  it('replaces the board without leaving anything to undo', () => {
    const board = roundTrip(exportBoard(source)); if (!board.ok) throw new Error(board.message);
    applyBoardFile(target, board);
    expect(store.command(target, { type: 'undo' }, tutor, true)).toEqual({ ok: false, message: 'Nothing to undo' });
    // New decks still get new set ids after the imported ones.
    run(target, { type: 'importDeck', id: 'more', position: { x: 0, y: 0 }, set: { name: 'More', widthMm: 63, heightMm: 88, faces: [{ fields: [{ name: 'A', kind: 'text', text: 'a' }] }] } });
    expect(target.cardSets.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('refuses damaged, foreign or future files with a clear message, and leaves the room as it was', () => {
    run(target, { type: 'create', object: { ...base('keep'), type: 'counter', color: '#3974e8', size: 54 } as BoardObject });
    const before = structuredClone(target.objects);
    const good = (): BoardFile => JSON.parse(JSON.stringify(exportBoard(source)));
    const cases: [unknown, RegExp][] = [
      [null, /not a ManiPad board file/],
      [{ hello: 'world' }, /not a ManiPad board file/],
      [{ ...good(), version: 'one' }, /no valid version/],
      [{ ...good(), version: 99 }, /newer version of ManiPad \(file version 99/],
      [{ ...good(), objects: 'nope' }, /damaged \(objects/],
      [{ ...good(), objects: Array.from({ length: 501 }, (_, i) => ({ ...base(`c${i}`), type: 'counter' })) }, /damaged \(objects/],
      [(() => { const f = good(); (f.objects[0] as DeckObject).cards = ['', '']; return f; })(), /invalid object \(#1, deck\)/],
      [(() => { const f = good(); f.objects.push({ ...f.objects[0] }); return f; })(), /same id/],
      [(() => { const f = good(); f.assets = {}; return f; })(), /picture it does not contain/],
      [(() => { const f = good(); (f.objects.find((o) => o.id === 'die') as DieObject).faces![0].image = `/api/rooms/${source.id}/card-images/AAAAAAAAAAAAAAAA`; return f; })(), /picture it does not contain/],
      [(() => { const f = good(); f.assets[Object.keys(f.assets)[0]].type = 'image/svg+xml'; return f; })(), /damaged \(assets/],
      [(() => { const f = good(); f.cardSets = []; return f; })(), /picture it does not contain|card from a deck it does not contain/],
      [(() => { const f = good(); f.cardSets[0] = { ...f.cardSets[0], id: 's7' }; return f; })(), /invalid card set/],
      [(() => { const f = good(); const big = Buffer.alloc(31_000_000).toString('base64'); f.assets.BBBBBBBBBBBBBBBB = { type: 'image/png', data: big }; return f; })(), /more pictures than a room can hold/],
    ];
    for (const [file, message] of cases) {
      const result = parseBoardFile(file, target);
      expect(result.ok, String(message)).toBe(false);
      if (!result.ok) expect(result.message).toMatch(message);
    }
    expect(target.objects).toEqual(before);
  });

  it('lets the browser catch the common problems before uploading', () => {
    expect(precheckBoardFile('{"format":"manipad-board",')).toBe('That file is not valid JSON');
    expect(precheckBoardFile('{"format":"other","version":1}')).toMatch(/not a ManiPad board file/);
    expect(precheckBoardFile('{"format":"manipad-board","version":2}')).toMatch(/newer version/);
    expect(precheckBoardFile(JSON.stringify(exportBoard(source)))).toBeUndefined();
  });
});
