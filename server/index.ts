import express from 'express';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { commandSchema, joinSchema } from '../src/shared/schemas.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../src/shared/types.js';
import { RoomStore, type Room } from './room-store.js';

const app = express(); const server = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, { cors: { origin: true }, maxHttpBufferSize: 8_000_000 });
const store = new RoomStore();
app.use(express.json());
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: store.rooms.size }));
app.post('/api/rooms', (_req, res) => { const room = store.create(); res.status(201).json({ roomId: room.id, tutorToken: room.tutorToken }); });
app.get('/api/rooms/:id', (req, res) => res.json({ exists: Boolean(store.get(req.params.id)) }));
// Card images never change once imported (each has its own random token), so browsers may cache them for good.
app.get('/api/rooms/:id/card-images/:token', (req, res) => {
  const image = store.get(req.params.id)?.cardImages.get(req.params.token); if (!image) return res.sendStatus(404);
  res.set({ 'Content-Type': image.type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }).send(image.data);
});

io.use((socket, next) => {
  const parsed = joinSchema.safeParse(socket.handshake.auth);
  if (!parsed.success) return next(new Error('Invalid room details'));
  const room = store.get(parsed.data.roomId); if (!room) return next(new Error('Room not found'));
  if (room.participants.size >= 8 && !room.participants.has(parsed.data.participantId)) return next(new Error('Room is full'));
  if (!store.claim(room, parsed.data.participantId, parsed.data.secret)) return next(new Error('This player is already in the room from another browser'));
  socket.data.join = parsed.data; next();
});

/** Each participant gets their own snapshot: private card faces are only sent to the owner of the hand. */
function broadcastSnapshot(room: Room) {
  for (const socketId of io.sockets.adapter.rooms.get(room.id) ?? []) {
    const target = io.sockets.sockets.get(socketId); const viewer = target?.data.join?.participantId as string | undefined;
    if (target && viewer) target.emit('snapshot', store.snapshotFor(room, viewer));
  }
}

io.on('connection', (socket) => {
  const joinData = socket.data.join as ReturnType<typeof joinSchema.parse>;
  const room = store.get(joinData.roomId)!; const isTutor = store.isTutor(room, joinData.tutorToken);
  room.emptySince = undefined; room.participants.set(joinData.participantId, { id: joinData.participantId, name: joinData.name, color: joinData.color, isTutor, selection: [] });
  store.refreshHandLabels(room, joinData.participantId);
  socket.join(room.id); broadcastSnapshot(room);

  socket.on('command', (raw, ack) => {
    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success) return ack?.({ ok: false, message: 'Invalid board action' });
    const result = store.command(room, parsed.data as Parameters<typeof store.command>[1], joinData.participantId, isTutor);
    if (!result.ok) return ack?.(result);
    broadcastSnapshot(room); ack?.({ ok: true });
  });
  socket.on('cursor', (payload) => {
    if (!Number.isFinite(payload?.cursor?.x) || !Number.isFinite(payload?.cursor?.y)) return;
    const participant = room.participants.get(joinData.participantId); if (!participant) return;
    participant.cursor = payload.cursor; participant.selection = payload.selection.slice(0, 50);
    socket.to(room.id).emit('cursor', { participantId: joinData.participantId, cursor: payload.cursor, selection: participant.selection });
  });
  socket.on('reaction', (emoji) => { if (['👍','🎉','💡','👏'].includes(emoji)) io.to(room.id).emit('reaction', { participantId: joinData.participantId, emoji, nonce: Date.now() }); });
  socket.on('control', (payload, ack) => {
    if (!isTutor) return ack?.({ ok: false });
    if (payload.action === 'lock') room.locked = true; else if (payload.action === 'unlock') room.locked = false;
    else if (payload.action === 'reset-view') io.to(room.id).emit('view:reset');
    broadcastSnapshot(room); ack?.({ ok: true });
  });
  socket.on('disconnect', () => {
    room.participants.delete(joinData.participantId); if (room.participants.size === 0) room.emptySince = Date.now();
    else io.to(room.id).emit('presence', [...room.participants.values()]);
  });
});

const here = dirname(fileURLToPath(import.meta.url)); const clientDir = join(here, '../../dist');
app.use(express.static(clientDir));
app.use((req, res, next) => req.method === 'GET' && !req.path.startsWith('/api/') ? res.sendFile(join(clientDir, 'index.html')) : next());
setInterval(() => store.cleanup(), 60_000).unref();
const port = Number(process.env.PORT || 3000); server.listen(port, () => console.log(`ManiPad listening on http://localhost:${port}`));

export { app, server, store };
