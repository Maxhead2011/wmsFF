import { useEffect, useRef, useState } from 'react';

export type FbsReturnReceiptScans = { returnBoxCode: string; returnBarcode: string; returnKiz: string };
export const receiptScansReady = (scans: FbsReturnReceiptScans, requiresKiz: boolean) => Boolean(
  scans.returnBoxCode.trim() && scans.returnBarcode.trim() && (!requiresKiz || scans.returnKiz.trim()),
);

// FIX: new physical scans only; no copying source locations or saved KIZs into receipt fields.
export function FbsReturnReceiptDialog(props: {
  orderId: string; productName: string; requiresKiz: boolean; busy: boolean; error?: string;
  onSubmit: (scans: FbsReturnReceiptScans) => Promise<void> | void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const barcode = useRef<HTMLInputElement>(null);
  const kiz = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [scans, setScans] = useState<FbsReturnReceiptScans>({ returnBoxCode: '', returnBarcode: '', returnKiz: '' });
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  const update = (key: keyof FbsReturnReceiptScans, value: string) => setScans(current => ({ ...current, [key]: value }));
  return (
    <dialog ref={dialog} aria-label="Повторная приёмка возврата FBS"
      style={{ width: 'min(520px, calc(100vw - 32px))', maxHeight: '90vh', overflow: 'auto', borderRadius: 12, padding: 24, border: '1px solid #b8c0cc' }}
      onCancel={event => { event.preventDefault(); if (!props.busy) props.onClose(); }}>
      <h3>Повторная приёмка · заказ №{props.orderId}</h3>
      <p>{props.productName}</p>
      <p>Товар уже изъят. Отсканируйте новое место приёмки и сам товар. До подтверждения он не станет доступным для сборки.</p>
      <form onSubmit={async event => {
        event.preventDefault();
        if (props.busy || submitting.current || !receiptScansReady(scans, props.requiresKiz)) return;
        submitting.current = true;
        try { await props.onSubmit(scans); } finally { submitting.current = false; }
      }}>
        <fieldset disabled={props.busy} style={{ border: 0, padding: 0, display: 'grid', gap: 12 }}>
          <label>Бокс назначения
            <input name="returnBoxCode" autoFocus required autoComplete="off" value={scans.returnBoxCode}
              style={{ display: 'block', width: '100%' }} onChange={event => update('returnBoxCode', event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); barcode.current?.focus(); } }} />
          </label>
          <label>ШК товара
            <input ref={barcode} name="returnBarcode" required autoComplete="off" value={scans.returnBarcode}
              style={{ display: 'block', width: '100%' }} onChange={event => update('returnBarcode', event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && props.requiresKiz) { event.preventDefault(); kiz.current?.focus(); } }} />
          </label>
          {props.requiresKiz ? <label>КИЗ товара
            <input ref={kiz} name="returnKiz" required autoComplete="off" value={scans.returnKiz}
              style={{ display: 'block', width: '100%' }} onChange={event => update('returnKiz', event.target.value)} />
          </label> : null}
          {props.error ? <p role="alert">{props.error}</p> : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <button type="submit" disabled={!receiptScansReady(scans, props.requiresKiz)}>{props.busy ? 'Принимаю…' : 'Принять в бокс'}</button>
            <button type="button" onClick={props.onClose}>Отмена</button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
