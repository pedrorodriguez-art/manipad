import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/** An in-app confirmation (styled like the other dialogs, and unlike `confirm()` it does not freeze the page). */
export function ConfirmDialog({ title, message, confirmLabel, danger = false, onCancel, onConfirm }: { title: string; message: string; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onCancel]);
  return createPortal(<div className="dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
    <div className="die-dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
      <h2>{title}</h2><p>{message}</p>
      <div className="die-dialog-actions"><button type="button" className="button" onClick={onCancel} autoFocus>Cancel</button><button type="button" className={`button ${danger ? 'danger-fill' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button></div>
    </div>
  </div>, document.body);
}
