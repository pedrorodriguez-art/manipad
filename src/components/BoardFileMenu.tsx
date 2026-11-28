import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from './ConfirmDialog';
import { downloadBoard, readBoardFile, uploadBoard } from '../boardTransfer';

/**
 * The tutor's "Board file" menu, in the room bar: export the whole board to a .json file, or replace it with a saved one
 * (after confirming, since it changes the board for everyone). See D-011.
 */
export function BoardFileMenu({ roomId, tutorToken, onError }: { roomId: string; tutorToken: string; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false); const [task, setTask] = useState<'saving' | 'opening'>(); const [pending, setPending] = useState<{ name: string; text: string }>();
  const input = useRef<HTMLInputElement>(null), root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!(e.target instanceof Node && root.current?.contains(e.target))) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close, true); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', escape); };
  }, [open]);
  const message = (error: unknown, fallback: string) => onError(error instanceof Error ? error.message : fallback);

  async function save() { setOpen(false); setTask('saving'); try { await downloadBoard(roomId, tutorToken); } catch (error) { message(error, 'Could not save the board'); } finally { setTask(undefined); } }
  async function pick(file: File) { try { setPending({ name: file.name, text: await readBoardFile(file) }); } catch (error) { message(error, 'Could not read that file'); } }
  async function replace() {
    const board = pending; setPending(undefined); if (!board) return;
    setTask('opening'); try { await uploadBoard(roomId, tutorToken, board.text); } catch (error) { message(error, 'Could not open that board'); } finally { setTask(undefined); }
  }

  return <div className="board-file-menu" ref={root}>
    <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} disabled={Boolean(task)} title="Save the board to a file, or open a saved one">⇅ <span>Board file</span></button>
    {open && <div role="menu" aria-label="Board file">
      <button role="menuitem" onClick={() => void save()}><b>⤓ Export board</b><small>Download everything on the board</small></button>
      <button role="menuitem" onClick={() => { setOpen(false); input.current?.click(); }}><b>⤒ Import board…</b><small>Replace the board with a saved file</small></button>
    </div>}
    <input ref={input} type="file" accept=".json,application/json" hidden aria-label="Import board file" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void pick(file); }} />
    {pending && <ConfirmDialog title="Replace the board?" message={`“${pending.name}” will replace the current board for everyone in this room. This cannot be undone.`} confirmLabel="Replace board" danger onCancel={() => setPending(undefined)} onConfirm={() => void replace()} />}
    {task && createPortal(<div className="upload-progress board-file-status" role="status" aria-live="polite"><span>{task === 'saving' ? 'Saving the board…' : 'Opening the board…'}</span><progress aria-label="Board file progress" /></div>, document.body)}
  </div>;
}
