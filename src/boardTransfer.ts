import { BOARD_FILE, BOARD_FILE_MESSAGES, precheckBoardFile } from './shared/boardFile';

/** Saving and opening a board from the browser (tutor only; see server/board-file.ts and D-011). */
const endpoint = (roomId: string) => `/api/rooms/${encodeURIComponent(roomId)}/board-file`;
const messageOf = async (response: Response, fallback: string) => { try { return ((await response.json()) as { message?: string }).message || fallback; } catch { return fallback; } };

/** Downloads the room's board as a .json file. */
export async function downloadBoard(roomId: string, tutorToken: string) {
  const response = await fetch(endpoint(roomId), { headers: { 'X-Tutor-Token': tutorToken } });
  if (!response.ok) throw new Error(await messageOf(response, 'Could not save the board'));
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? `manipad-${roomId}.json`;
  const link = document.createElement('a'); link.href = URL.createObjectURL(await response.blob()); link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** Reads a picked file and runs the checks a browser can make; throws with a message for the person if it cannot be opened. */
export async function readBoardFile(file: File): Promise<string> {
  if (file.size > BOARD_FILE.maxBytes) throw new Error(BOARD_FILE_MESSAGES.tooLarge);
  const text = await file.text();
  const problem = precheckBoardFile(text); if (problem) throw new Error(problem);
  return text;
}

/** Replaces the room's board with a file read by `readBoardFile`. Everyone gets the new board from the server. */
export async function uploadBoard(roomId: string, tutorToken: string, text: string) {
  const response = await fetch(endpoint(roomId), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': tutorToken }, body: text });
  if (!response.ok) throw new Error(await messageOf(response, 'Could not open that board'));
}
