import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomStore, type Room } from './room-store';
import { boardObjectSchema, commandSchema } from '../src/shared/schemas';
import { dieFaceLabel } from '../src/shared/dice';
import type { BoardCommand, DieFace, DieObject } from '../src/shared/types';

const leo = 'leo-participant', maya = 'maya-participant';
const png = (seed: number) => `data:image/png;base64,${Buffer.from([137, 80, 78, 71, seed]).toString('base64')}`;
const die = (id = 'die', extra: Partial<DieObject> = {}): DieObject => ({ id, type: 'die', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, z: 0, locked: false, creator: leo, revision: 0, value: 1, color: '#3974e8', rollNonce: 0, ...extra });
let store: RoomStore; let room: Room;
const run = (command: BoardCommand, actor = leo, isTutor = false) => store.command(room, command, actor, isTutor);
const find = (id: string) => room.objects.find((o) => o.id === id) as DieObject;

beforeEach(() => {
  store = new RoomStore(); room = store.create();
  for (const [id, name] of [[leo, 'Leo'], [maya, 'Maya']]) room.participants.set(id, { id, name, color: '#e85c62', isTutor: false, selection: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('custom dice', () => {
  it('rolls within the die’s own number of faces', () => {
    run({ type: 'create', object: die('d20', { sides: 20 }) });
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(run({ type: 'rollDie', id: 'd20' })).toEqual({ ok: true });
    expect(find('d20')).toMatchObject({ value: 20, rollNonce: 1 });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    run({ type: 'rollDie', id: 'd20' });
    expect(find('d20')).toMatchObject({ value: 1, rollNonce: 2 });
  });

  it('rolls several dice at once, as one step that undo reverts', () => {
    run({ type: 'create', object: die('a') }); run({ type: 'create', object: die('b', { sides: 4 }) }); run({ type: 'create', object: die('c') });
    const before = structuredClone(room.objects);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(run({ type: 'rollDice', ids: ['a', 'b'] })).toEqual({ ok: true });
    expect([find('a'), find('b'), find('c')].map((d) => [d.value, d.rollNonce])).toEqual([[4, 1], [3, 1], [before[2].type === 'die' ? before[2].value : 0, 0]]);
    run({ type: 'undo' }, maya);
    expect(room.objects).toEqual(before);
  });

  it('never lets a client choose what a die shows', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    run({ type: 'create', object: die('d', { value: 6 }) });
    expect(find('d').value).toBe(1); // the server rolls the starting value too
    run({ type: 'update', ids: ['d'], patch: { value: 6, rollNonce: 9, sides: 2, faces: [{ text: 'x' }, { text: 'y' }], x: 40, color: '#e85c62' } as never });
    expect(find('d')).toMatchObject({ value: 1, rollNonce: 0, x: 40, color: '#e85c62' });
    expect(find('d').sides).toBeUndefined(); expect(find('d').faces).toBeUndefined();
  });

  it('validates sides and faces', () => {
    const valid = (extra: Partial<DieObject>) => boardObjectSchema.safeParse(die('d', extra)).success;
    expect(valid({})).toBe(true);
    expect(valid({ sides: 20, value: 20 })).toBe(true);
    expect(valid({ sides: 1 })).toBe(false);
    expect(valid({ sides: 21 })).toBe(false);
    expect(valid({ sides: 4, value: 5 })).toBe(false);
    expect(valid({ value: 7 })).toBe(false); // a die without `sides` is a d6
    expect(valid({ sides: 3, faces: [{ text: 'Sim' }, { text: 'Não' }, { text: 'Talvez' }] })).toBe(true);
    expect(valid({ sides: 3, faces: [{ text: 'Sim' }, { text: 'Não' }] })).toBe(false);
    expect(valid({ sides: 2, faces: [{ text: 'thirteen chars' }, {}] })).toBe(false);
    expect(valid({ sides: 2, faces: [{ image: png(1) }, {}] })).toBe(true);
    expect(valid({ sides: 2, faces: [{ image: 'data:image/svg+xml;base64,PHN2Zz4=' }, {}] })).toBe(false);
    expect(valid({ sides: 2, faces: [{ image: 'https://example.com/a.png' }, {}] })).toBe(false);
    expect(valid({ sides: 2, faces: [{ text: 'a', html: '<b>' } as DieFace, {}] })).toBe(false);
    expect(valid({ color: 'red' })).toBe(false);
    expect(commandSchema.safeParse({ type: 'rollDice', ids: [] }).success).toBe(false);
    expect(commandSchema.safeParse({ type: 'editDie', id: 'd', sides: 3, faces: [{}, {}], color: '#3974e8' }).success).toBe(false);
  });

  it('keeps face pictures on the server and sends only their URL', () => {
    expect(run({ type: 'create', object: die('img', { sides: 2, faces: [{ image: png(1) }, { text: 'B' }] }) })).toEqual({ ok: true });
    const face = find('img').faces![0].image!;
    expect(face).toMatch(new RegExp(`^/api/rooms/${room.id}/card-images/[A-Za-z0-9_-]{16}$`));
    expect(room.cardImages.get(face.split('/').pop()!)?.type).toBe('image/png');
    expect(JSON.stringify(store.snapshotFor(room, maya))).not.toContain('base64');
    expect(dieFaceLabel(find('img'), 1)).toBe(`img:${face}`); expect(dieFaceLabel(find('img'), 2)).toBe('B');
    // A copy reuses the picture the room already has.
    expect(run({ type: 'create', object: { ...find('img'), id: 'copy' } })).toEqual({ ok: true });
    expect(find('copy').faces![0].image).toBe(face);
    expect(room.cardImages.size).toBe(1);
  });

  it('refuses pictures the room does not have', () => {
    const other = store.create();
    const foreign = `/api/rooms/${other.id}/card-images/AAAAAAAAAAAAAAAA`;
    other.cardImages.set('AAAAAAAAAAAAAAAA', { type: 'image/png', data: Buffer.from([1]) });
    expect(run({ type: 'create', object: die('x', { sides: 2, faces: [{ image: foreign }, {}] }) })).toMatchObject({ ok: false });
    expect(run({ type: 'create', object: die('y', { sides: 2, faces: [{ image: `/api/rooms/${room.id}/card-images/BBBBBBBBBBBBBBBB` }, {}] }) })).toMatchObject({ ok: false });
    expect(room.objects).toHaveLength(0);
  });

  it('stores nothing when the die is refused', () => {
    room.locked = true;
    expect(run({ type: 'create', object: die('locked', { sides: 2, faces: [{ image: png(2) }, {}] }) })).toMatchObject({ ok: false });
    expect(room.cardImages.size).toBe(0);
    room.locked = false;
    run({ type: 'create', object: die('d') });
    expect(run({ type: 'create', object: die('d', { sides: 2, faces: [{ image: png(3) }, {}] }) })).toMatchObject({ ok: false }); // duplicate id
    expect(room.cardImages.size).toBe(0);
  });

  it('edits faces, keeping the value when it still exists', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    run({ type: 'create', object: die('d', { sides: 10 }) }); expect(find('d').value).toBe(10);
    expect(run({ type: 'editDie', id: 'd', sides: 12, color: '#24a47a' })).toEqual({ ok: true });
    expect(find('d')).toMatchObject({ sides: 12, value: 10, color: '#24a47a', rollNonce: 0 });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(run({ type: 'editDie', id: 'd', sides: 2, faces: [{ text: 'Sim' }, { image: png(4) }], color: '#24a47a' })).toEqual({ ok: true });
    expect(find('d')).toMatchObject({ sides: 2, value: 1 });
    expect(find('d').faces![1].image).toMatch(/^\/api\/rooms\//);
    run({ type: 'editDie', id: 'd', sides: 6, color: '#24a47a' });
    expect(find('d').faces).toBeUndefined();
  });

  it('respects the board lock for rolls', () => {
    run({ type: 'create', object: die('d') });
    room.locked = true;
    expect(run({ type: 'rollDie', id: 'd' })).toMatchObject({ ok: false });
    expect(run({ type: 'rollDice', ids: ['d'] }, maya, true)).toEqual({ ok: true });
  });
});
