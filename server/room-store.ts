import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { BoardCommand, BoardObject, CardSet, DeckObject, Participant, RoomSnapshot } from '../src/shared/types.js';
import { CARD_SET_LIMITS } from '../src/shared/schemas.js';
import { applyCommand } from '../src/shared/engine.js';
import { authorize } from './permissions.js';
import { projectObjects } from './visibility.js';

export interface Room {
  id: string; tutorToken: string; objects: BoardObject[]; participants: Map<string, Participant>;
  locked: boolean; revision: number; history: BoardObject[][]; future: BoardObject[][];
  /** sha256 of each participant's secret, so a public participantId cannot be reused by someone else to see that person's hand. */
  secrets: Map<string, Buffer>;
  /** Imported card faces. Append-only (undo and clear keep them), so putting a hidden card into a deck never changes what is sent. */
  cardSets: CardSet[];
  emptySince?: number;
}

export type CommandResult = { ok: true } | { ok: false; message: string };

const wordsA = ['bright','calm','clever','happy','kind','swift','tiny','wise'];
const wordsB = ['badger','comet','dolphin','fox','koala','otter','panda','tiger'];
const digest = (secret: string) => createHash('sha256').update(secret).digest();

export class RoomStore {
  readonly rooms = new Map<string, Room>();
  create(): Room {
    let id = '';
    do id = `${wordsA[Math.floor(Math.random()*wordsA.length)]}-${wordsB[Math.floor(Math.random()*wordsB.length)]}-${Math.floor(10+Math.random()*90)}`; while (this.rooms.has(id));
    const room: Room = { id, tutorToken: randomBytes(24).toString('base64url'), objects: [], participants: new Map(), locked: false, revision: 0, history: [], future: [], secrets: new Map(), cardSets: [] };
    this.rooms.set(id, room); return room;
  }
  get(id: string) { return this.rooms.get(id); }
  isTutor(room: Room, token?: string) { return Boolean(token && token === room.tutorToken); }
  /** The first join with a participantId claims it; later joins must present the same secret. */
  claim(room: Room, participantId: string, secret: string): boolean {
    const known = room.secrets.get(participantId), presented = digest(secret);
    if (!known) { room.secrets.set(participantId, presented); return true; }
    return timingSafeEqual(known, presented);
  }
  /** The room as seen by one participant: hidden card faces and deck order are removed (see visibility.ts). */
  snapshotFor(room: Room, viewerId: string): RoomSnapshot {
    return { version: 1, roomId: room.id, objects: projectObjects(room.objects, viewerId), participants: [...room.participants.values()], locked: room.locked, revision: room.revision, cardSets: room.cardSets };
  }
  command(room: Room, command: BoardCommand, actor: string, isTutor: boolean): CommandResult {
    if (room.locked && !isTutor) return { ok: false, message: 'The tutor locked the board' };
    if (command.type === 'clear' && !isTutor) return { ok: false, message: 'Only the tutor can clear the board' };
    if (command.type === 'undo') {
      const previous = room.history.pop(); if (!previous) return { ok: false, message: 'Nothing to undo' };
      room.future.push(structuredClone(room.objects)); room.objects = previous; room.revision++; return { ok: true };
    }
    if (command.type === 'redo') {
      const future = room.future.pop(); if (!future) return { ok: false, message: 'Nothing to redo' };
      room.history.push(structuredClone(room.objects)); room.objects = future; room.revision++; return { ok: true };
    }
    const denied = authorize(room.objects, command, { id: actor, isTutor }, room.participants);
    if (denied) return { ok: false, message: denied };
    command = this.withOwnerDetails(room, command);
    if (command.type === 'importDeck') return this.importDeck(room, command, actor);
    const streamingStroke = command.type === 'update' && 'points' in command.patch;
    if (!streamingStroke) { room.history.push(structuredClone(room.objects)); if (room.history.length > 60) room.history.shift(); room.future = []; }
    const next = applyCommand({ objects: room.objects, revision: room.revision }, command, actor);
    if (next.objects === room.objects) { if (!streamingStroke) room.history.pop(); return { ok: false, message: 'Action unavailable' }; }
    room.objects = next.objects; room.revision = next.revision; return { ok: true };
  }
  /** Registers the set, then places a face-down deck with its first card on top (an ordinary, undoable `create`). */
  private importDeck(room: Room, command: Extract<BoardCommand, { type: 'importDeck' }>, actor: string): CommandResult {
    if (room.cardSets.length >= CARD_SET_LIMITS.perRoom) return { ok: false, message: `A room can have at most ${CARD_SET_LIMITS.perRoom} imported decks` };
    const set: CardSet = { ...command.set, id: `s${room.cardSets.length + 1}` };
    const cards = set.faces.map((_, i) => `${set.id}:${i}`).reverse();
    const deck: DeckObject = { id: command.id, type: 'deck', x: command.position.x, y: command.position.y, rotation: 0, scaleX: 1, scaleY: 1, z: 0, locked: false, creator: actor, revision: 0, cards, initialCards: [...cards], faceUp: false };
    if (room.objects.some((o) => o.id === deck.id)) return { ok: false, message: 'Action unavailable' };
    const result = this.command(room, { type: 'create', object: deck }, actor, true);
    if (result.ok) room.cardSets.push(set);
    return result;
  }
  /** A hand's label and color always come from the participant list, never from the client. */
  private withOwnerDetails(room: Room, command: BoardCommand): BoardCommand {
    const ownerId = command.type === 'create' && command.object.type === 'region' ? command.object.ownerId : command.type === 'assignRegion' ? command.ownerId : undefined;
    const owner = ownerId ? room.participants.get(ownerId) : undefined;
    if (!owner) return command;
    if (command.type === 'create') return { ...command, object: { ...command.object, ownerName: owner.name, color: owner.color } as BoardObject };
    return { ...command, ownerName: owner.name, color: owner.color } as BoardCommand;
  }
  /** Keeps a hand's label in sync when its owner rejoins with a new name or color. */
  refreshHandLabels(room: Room, participantId: string) {
    const owner = room.participants.get(participantId); if (!owner) return;
    room.objects = room.objects.map((o) => o.type === 'region' && o.ownerId === participantId && (o.ownerName !== owner.name || o.color !== owner.color) ? { ...o, ownerName: owner.name, color: owner.color } : o);
  }
  cleanup(now = Date.now(), ttl = 30 * 60_000) {
    for (const [id, room] of this.rooms) if (room.participants.size === 0 && room.emptySince && now - room.emptySince > ttl) this.rooms.delete(id);
  }
}
