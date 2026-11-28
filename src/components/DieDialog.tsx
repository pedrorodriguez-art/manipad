import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DieFace, DieObject } from '../shared/types';
import { DIE_LIMITS, dieSides } from '../shared/dice';
import { dieFaceImage } from '../dieFaces';

export type DieDesign = { sides: number; faces?: DieFace[]; color: string };
const PRESETS = [4, 6, 8, 10, 12, 20];
const clampSides = (value: number) => Math.min(DIE_LIMITS.maxSides, Math.max(DIE_LIMITS.minSides, Math.round(value) || 6));

/**
 * Creates a die or edits one: number of faces, color and, optionally, what each face shows (a short text or a picture).
 * `onSubmit` resolves to true once the server accepted it; the dialog stays open (and shows nothing new) otherwise.
 */
export function DieDialog({ die, defaultColor, palette, onCancel, onSubmit }: { die?: DieObject; defaultColor: string; palette: string[]; onCancel: () => void; onSubmit: (design: DieDesign) => Promise<boolean> }) {
  const [sidesText, setSidesText] = useState(String(die ? dieSides(die) : 6));
  const [custom, setCustom] = useState(Boolean(die?.faces?.length));
  const [faces, setFaces] = useState<{ text: string; image?: string }[]>(() => Array.from({ length: DIE_LIMITS.maxSides }, (_, i) => ({ text: die?.faces?.[i]?.text ?? '', image: die?.faces?.[i]?.image })));
  const [color, setColor] = useState(die?.color ?? defaultColor);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null); const picking = useRef(0);
  const sides = clampSides(Number(sidesText));
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [busy, onCancel]);

  const setFace = (index: number, face: { text: string; image?: string }) => setFaces((all) => all.map((f, i) => (i === index ? face : f)));
  async function pick(file: File) {
    const index = picking.current; setError('');
    try { setFace(index, { text: '', image: await dieFaceImage(file) }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not use that picture'); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    const chosen = faces.slice(0, sides).map((f) => ({ ...(f.text.trim() ? { text: f.text.trim() } : {}), ...(f.image ? { image: f.image } : {}) }));
    const design: DieDesign = { sides, color, ...(custom && chosen.some((f) => f.text || f.image) ? { faces: chosen } : {}) };
    setBusy(true); setError('');
    const ok = await onSubmit(design);
    if (!ok) { setBusy(false); setError('The die could not be saved'); }
  }

  return createPortal(<div className="dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
    <form className="die-dialog" role="dialog" aria-modal="true" aria-label={die ? 'Edit die' : 'Custom die'} onSubmit={submit}>
      <h2>{die ? 'Edit die' : 'Custom die'}</h2>
      <div className="die-dialog-row">
        <label htmlFor="die-sides">Faces</label>
        <input id="die-sides" type="number" inputMode="numeric" min={DIE_LIMITS.minSides} max={DIE_LIMITS.maxSides} value={sidesText} onChange={(e) => setSidesText(e.target.value)} onBlur={() => setSidesText(String(sides))} aria-label="Number of faces" autoFocus />
        <div className="die-presets">{PRESETS.map((n) => <button type="button" key={n} className={sides === n ? 'active' : ''} onClick={() => setSidesText(String(n))}>d{n}</button>)}</div>
      </div>
      <div className="die-dialog-row">
        <span className="die-dialog-label">Color</span>
        <div className="die-colors">{palette.map((c) => <button type="button" key={c} style={{ background: c }} className={color === c ? 'active' : ''} onClick={() => setColor(c)} aria-label={`Die color ${c}`} />)}
          <label className="die-color-custom" style={{ background: color }} title="Other color"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Other die color" /></label></div>
      </div>
      <label className="die-dialog-check"><input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> Custom faces <small>(text or a picture on each face; empty faces show their number)</small></label>
      {custom && <ol className="die-faces">{faces.slice(0, sides).map((face, i) => <li key={i}>
        <span className="die-face-number">{i + 1}</span>
        {face.image
          ? <><img src={face.image} alt={`Face ${i + 1}`} /><button type="button" onClick={() => setFace(i, { text: '' })} aria-label={`Remove face ${i + 1} picture`}>Remove picture</button></>
          : <><input value={face.text} maxLength={DIE_LIMITS.text} placeholder={String(i + 1)} onChange={(e) => setFace(i, { text: e.target.value })} aria-label={`Face ${i + 1} text`} />
            <button type="button" onClick={() => { picking.current = i; fileInput.current?.click(); }} aria-label={`Face ${i + 1} picture`}>Picture…</button></>}
      </li>)}</ol>}
      <input ref={fileInput} type="file" accept="image/*" hidden aria-label="Die face picture file" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void pick(file); }} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="die-dialog-actions"><button type="button" className="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : die ? 'Save die' : 'Create die'}</button></div>
    </form>
  </div>, document.body);
}
