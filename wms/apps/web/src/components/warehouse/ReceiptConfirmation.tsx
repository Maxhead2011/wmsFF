import { useEffect, useId, useRef, type ReactNode } from 'react';
import './receipt-confirmation.css';

// FIX: native modal top layer avoids clipping and stacking contexts in warehouse panels.
export function ReceiptConfirmation({ title, children, busy, checking, message, onCancel }: {
  title: string; children: ReactNode; busy: boolean; checking?: boolean; message: string; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="receipt-confirmation" aria-labelledby={titleId}
    aria-modal="true" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h3 id={titleId}>{title}</h3>
    {message && <p role="status">{message}</p>}
    {busy && <p role="status" className="receipt-confirmation__progress">{checking ? "Проверяем доступность…" : "Сохраняем…"}</p>}
    {children}
  </dialog>;
}
