import { useEffect, useRef, useState } from 'react';
import type { FbsWbAccountingView } from '../../lib/api';

type Candidate = FbsWbAccountingView['candidates'][number];
export const wbAccountingCommentReady = (comment: string) => comment.trim().length >= 3 && comment.trim().length <= 1000;

// FIX: manager accounting is shown separately from scanned physical completions.
export function FbsWbAccounting({ data, busy, error, onAccount, canShip = false }: {
  data?: FbsWbAccountingView; busy: boolean; error?: string;
  canShip?: boolean;
  onAccount?: (assemblyId: string, orderId: string, comment: string) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<Candidate | null>(null);
  if (!data) return null;
  return <>
    {data.enabled && onAccount && data.candidates.length > 0 && <section className="online-execution-section">
      <h4>Обработаны WB — требуется решение</h4>
      <p>При подтверждении WMS проверит свежий статус WB. Заказ с привязанной парой КИЗ–ШК будет списан со склада и записан в историю отгрузок.</p>
      {data.candidates.map(row => <div key={row.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 0' }}>
        <span><strong>№{row.orderId} · {row.productName}</strong><br />WB: {row.wbStatus}
          {row.kiz && row.barcode && <><br />КИЗ: {row.kiz} · ШК: {row.barcode}</>}</span>
        {(!row.kiz || !row.barcode || canShip) && <button type="button" disabled={busy} onClick={() => setSelected(row)}>{row.kiz && row.barcode ? 'Подтвердить отгрузку по WB' : 'Учесть по статусу WB'}</button>}
      </div>)}
    </section>}
    {data.accounted.length > 0 && <details className="online-execution-section" open>
      <summary>Учтены по WB · {data.accounted.length}</summary>
      <p>Решения подтверждены менеджером после проверки WB.</p>
      {data.accounted.map(row => <div key={row.id} style={{ padding: '12px 0', borderTop: '1px solid #dbe2ea', overflowWrap: 'anywhere' }}>
        <strong>№{row.orderId} · {row.productName}</strong>
        {row.shipped ? <div><strong>Отгружен со склада по WB</strong><br />КИЗ: {row.kiz} · ШК: {row.barcode}<br />Источник: {row.sourceBoxCode || 'Без короба'}</div>
          : <div>Учтён без складского списания</div>}
        <div>WB при подтверждении: {row.wbStatus}</div>
        <div>{row.confirmedByName || 'Сотрудник не указан'} · {row.confirmedAt ? new Date(row.confirmedAt).toLocaleString('ru-RU') : 'Дата не указана'}</div>
        {row.comment && <div>{row.comment}</div>}
      </div>)}
    </details>}
    {selected && onAccount && <FbsWbAccountingDialog key={selected.id} orderId={selected.orderId} kiz={selected.kiz} barcode={selected.barcode} busy={busy} error={error}
      onClose={() => setSelected(null)} onSubmit={async comment => {
        if (await onAccount(selected.id, selected.orderId, comment)) setSelected(null);
      }} />}
  </>;
}

export function FbsWbAccountingDialog({ orderId, kiz, barcode, busy, error, onSubmit, onClose }: {
  orderId: string; busy: boolean; error?: string; onSubmit: (comment: string) => Promise<void>; onClose: () => void;
  kiz?: string | null; barcode?: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [comment, setComment] = useState('');
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} aria-label="Учесть заказ по статусу WB"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    style={{ width: 'min(560px, calc(100vw - 32px))', borderRadius: 12, padding: 24, border: '1px solid #b8c0cc' }}>
    <h3>Учесть по WB · №{orderId}</h3>
    {/* FIX: a manager explicitly sees the stock write-off and exact pair before confirmation. */}
    {kiz && barcode ? <p>WMS спишет одну единицу по паре КИЗ: {kiz} · ШК: {barcode} и сохранит отгрузку в истории.
      Если исходный короб не подтверждён в базе, источник будет указан как «Без короба». Другой короб для списания не подбирается.</p>
      : <p>Заказ останется в этой заявке и перейдёт в группу «Учтены по WB». Это решение не создаёт физическую сборку, сканы, КИЗ или списание товара.</p>}
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy || submitting.current || !wbAccountingCommentReady(comment)) return;
      submitting.current = true;
      try { await onSubmit(comment.trim()); } finally { submitting.current = false; }
    }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
        <label>Комментарий менеджера<textarea name="wbAccountingComment" required minLength={3} maxLength={1000}
          value={comment} onChange={event => setComment(event.target.value)} style={{ display: 'block', width: '100%', minHeight: 90 }} /></label>
        {error && <p role="alert">{error}</p>}
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button type="submit" disabled={!wbAccountingCommentReady(comment)}>{busy ? 'Проверяю WB…' : kiz && barcode ? 'Подтвердить списание и отгрузку' : 'Подтвердить учёт по WB'}</button>
          <button type="button" onClick={onClose}>Отмена</button>
        </div>
      </fieldset>
    </form>
  </dialog>;
}
