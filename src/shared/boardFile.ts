/**
 * A saved board: a JSON file with everything on the table (see D-011).
 *
 * `{ format: 'manipad-board', version, exportedAt, objects, cardSets, assets }`
 * - `objects` and `cardSets` are stored as the server keeps them, hidden cards and deck order included.
 * - Pictures the room serves (image-deck cards, die faces) are written as `asset:<token>` and their bytes go in
 *   `assets[token] = { type, data }` (base64), so the file is self-contained and does not depend on the room it came from.
 *
 * `version` grows when the format changes; the server upgrades older files step by step (`BOARD_FILE_MIGRATIONS` in
 * server/board-file.ts) and refuses files from newer versions.
 */
export const BOARD_FILE = {
  format: 'manipad-board',
  version: 1,
  /** Largest file accepted: the room's 30 MB of pictures in base64 (+33%) plus the board itself. */
  maxBytes: 45_000_000,
} as const;

export const ASSET_REF = /^asset:([A-Za-z0-9_-]{16})$/;

export const BOARD_FILE_MESSAGES = {
  notJson: 'That file is not valid JSON',
  notBoard: 'That is not a ManiPad board file',
  noVersion: 'That board file has no valid version number',
  newer: (version: number) => `That board was saved by a newer version of ManiPad (file version ${version}; this one opens up to version ${BOARD_FILE.version})`,
  tooLarge: `That file is too large (the limit is ${Math.round(BOARD_FILE.maxBytes / 1_000_000)} MB)`,
} as const;

/** The format and version of a parsed file, or a message saying why it cannot be opened. */
export function checkBoardEnvelope(file: unknown): string | undefined {
  if (!file || typeof file !== 'object' || (file as { format?: unknown }).format !== BOARD_FILE.format) return BOARD_FILE_MESSAGES.notBoard;
  const version = (file as { version?: unknown }).version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return BOARD_FILE_MESSAGES.noVersion;
  if (version > BOARD_FILE.version) return BOARD_FILE_MESSAGES.newer(version);
  return undefined;
}

/** The checks a browser can make before uploading, so the message comes early. The server checks everything again. */
export function precheckBoardFile(text: string): string | undefined {
  let file: unknown;
  try { file = JSON.parse(text); } catch { return BOARD_FILE_MESSAGES.notJson; }
  return checkBoardEnvelope(file);
}
