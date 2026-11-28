import { randomBytes } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { BoardCommand, BoardObject, ClientToServerEvents, RoomSnapshot, ServerToClientEvents } from '../../src/shared/types';

/**
 * Another player, driven from the test: it joins the room over the same socket as a browser, so what it does reaches the
 * page exactly like a real player's actions.
 */
export async function joinAsBot(baseURL: string, roomId: string, name = 'Bot') {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(baseURL, {
    transports: ['websocket'],
    auth: { roomId, participantId: `bot-${randomBytes(6).toString('hex')}`, secret: randomBytes(16).toString('hex'), name, color: '#24a47a', version: 1 },
  });
  let latest: RoomSnapshot | undefined;
  socket.on('snapshot', (snapshot) => { latest = snapshot; });
  await new Promise<void>((resolve, reject) => { socket.once('snapshot', () => resolve()); socket.once('connect_error', reject); });
  const command = (c: BoardCommand) => new Promise<{ ok: boolean; message?: string }>((resolve) => socket.emit('command', c, resolve));
  return {
    command,
    async run(c: BoardCommand) { const result = await command(c); if (!result.ok) throw new Error(`${c.type}: ${result.message}`); },
    objects: () => latest?.objects ?? [],
    close: () => socket.close(),
  };
}

export const objectBase = (id: string, x: number, y: number) => ({ id, x, y, rotation: 0, scaleX: 1, scaleY: 1, z: 0, locked: false, creator: 'bot', revision: 0 });
export const playingDeck = (id: string, x: number, y: number): BoardObject => {
  const cards = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].flatMap((r) => [0, 1, 2, 3].map((s) => `${r}${s}`));
  return { ...objectBase(id, x, y), type: 'deck', cards, initialCards: [...cards], faceUp: false };
};
