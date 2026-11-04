import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/appStore';

export function Toast() {
  const toast = useApp((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {toast.text}
    </div>
  );
}

export function DialogHost() {
  const dialog = useApp((s) => s.dialog);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dialog?.kind === 'prompt') {
      setValue(dialog.value);
      setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [dialog]);
  if (!dialog) return null;
  const cancel = () => (dialog.kind === 'confirm' ? dialog.resolve(false) : dialog.resolve(null));
  return (
    <div className="modal-backdrop" onClick={cancel}>
      <div className="modal small" role="dialog" aria-modal="true" aria-label={dialog.title} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{dialog.title}</h2>
        {dialog.kind === 'confirm' ? (
          <>
            <p className="muted">{dialog.message}</p>
            <div className="row end gap">
              <button className="btn" onClick={() => dialog.resolve(false)}>
                キャンセル
              </button>
              <button className={dialog.danger ? 'btn danger' : 'btn primary'} onClick={() => dialog.resolve(true)} autoFocus>
                OK
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              dialog.resolve(value.trim() || null);
            }}
          >
            <input ref={inputRef} className="input" value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} aria-label={dialog.title} />
            <div className="row end gap" style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => dialog.resolve(null)}>
                キャンセル
              </button>
              <button type="submit" className="btn primary">
                OK
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
