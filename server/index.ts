import express from 'express';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { commandSchema, joinSchema } from '../src/shared/schemas.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../src/shared/types.js';
import { RoomStore, type Room } from './room-store.js';
import { applyBoardFile, exportBoard, parseBoardFile } from './board-file.js';
import { BOARD_FILE, BOARD_FILE_MESSAGES } from '../src/shared/boardFile.js';

const app = express(); const server = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, { cors: { origin: true }, maxHttpBufferSize: 8_000_000 });
const store = new RoomStore();
const boardFileJson = express.json({ limit: BOARD_FILE.maxBytes });
// Board files are large; every other JSON body is small.
app.use((req, res, next) => (req.path.endsWith('/board-file') ? next() : express.json()(req, res, next)));
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: store.rooms.size }));
app.post('/api/rooms', (_req, res) => { const room = store.create(); res.status(201).json({ roomId: room.id, tutorToken: room.tutorToken }); });
app.get('/api/rooms/:id', (req, res) => res.json({ exists: Boolean(store.get(req.params.id)) }));
// Card images never change once imported (each has its own random token), so browsers may cache them for good.
app.get('/api/rooms/:id/card-images/:token', (req, res) => {
  const image = store.get(req.params.id)?.cardImages.get(req.params.token); if (!image) return res.sendStatus(404);
  res.set({ 'Content-Type': image.type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }).send(image.data);
});

/**
 * Saving and opening a whole board (see D-011). Only the tutor may do either: the file has every hidden card and the deck
 * order, and opening one replaces the board for everyone, like Clear. The tutor proves it with the room's tutor token.
 */
function tutorRoom(req: express.Request, res: express.Response): Room | undefined {
  const room = store.get(req.params.id as string); if (!room) { res.status(404).json({ message: 'Room not found' }); return undefined; }
  if (!store.isTutor(room, req.get('X-Tutor-Token') ?? undefined)) { res.status(403).json({ message: 'Only the tutor can save or open a board' }); return undefined; }
  return room;
}
app.get('/api/rooms/:id/board-file', (req, res) => {
  const room = tutorRoom(req, res); if (!room) return;
  const day = new Date().toISOString().slice(0, 10);
  res.set({ 'Content-Disposition': `attachment; filename="manipad-${room.id}-${day}.json"`, 'Cache-Control': 'no-store' }).json(exportBoard(room));
});
app.put('/api/rooms/:id/board-file', (req, res, next) => (tutorRoom(req, res) ? next() : undefined), boardFileJson, (req, res) => {
  const room = store.get(req.params.id as string)!;
  const board = parseBoardFile(req.body, room); if (!board.ok) return res.status(400).json({ message: board.message });
  applyBoardFile(room, board); broadcastSnapshot(room); io.to(room.id).emit('view:reset');
  res.json({ ok: true, objects: room.objects.length });
});
// The body parser's own errors (a file that is not JSON, or too large) come back as messages, not as an HTML page.
app.use('/api/rooms/:id/board-file', (error: { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.type === 'entity.too.large' ? 413 : 400).json({ message: error.type === 'entity.too.large' ? BOARD_FILE_MESSAGES.tooLarge : BOARD_FILE_MESSAGES.notJson });
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
