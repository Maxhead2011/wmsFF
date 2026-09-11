import { useEffect, useRef, useState } from 'react';
import type { FbsPickedDisposition, FbsSyncConflictResolutionAction } from '../../lib/api';

export type FbsManagerDecision = { pickedDisposition: FbsPickedDisposition; comment: string };

// FIX: manager acknowledgement must never enter the physical-return scan gate.
export function needsFbsReturnScans(action: FbsSyncConflictResolutionAction, rows: Array<{ requiresReturnReceipt?: boolean }>) {
  return action === 'RETURN_TO_STOCK' && rows.some(row => row.requiresReturnReceipt);
}

export function managerDecisionReady(disposition: string, comment: string) {
  return ['SHIP_WITH_WB_LABEL', 'AWAIT_RETURN_RECEIPT'].includes(disposition) && Boolean(comment.trim());
}

export function FbsManagerDecisionDialog(props: {
  orderCount: number; busy: boolean; error?: string;
  onSubmit: (decision: FbsManagerDecision) => Promise<void> | void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [disposition, setDisposition] = useState<FbsPickedDisposition | ''>('');
  const [comment, setComment] = useState('');
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} aria-label="Решение менеджера по изъятому товару"
    style={{ width: 'min(580px, calc(100vw - 32px))', maxHeight: '90vh', overflow: 'auto', borderRadius: 12, padding: 24, border: '1px solid #b8c0cc' }}
    onCancel={event => { event.preventDefault(); if (!props.busy) props.onClose(); }}>
    <h3>Решение менеджера · {props.orderCount} поз.</h3>
    <p>Изъятие уже списало товар из исходного короба. Решение сохранит списание и не восстановит доступный остаток.</p>
    {props.orderCount > 1 ? <p>Выберите один исход для всех выбранных позиций. Если исходы разные, оформите их отдельными группами.</p> : null}
    <form onSubmit={async event => {
      event.preventDefault();
      if (props.busy || submitting.current || !managerDecisionReady(disposition, comment)) return;
      submitting.current = true;
      try { await props.onSubmit({ pickedDisposition: disposition as FbsPickedDisposition, comment: comment.trim() }); }
      finally { submitting.current = false; }
    }}>
      <fieldset disabled={props.busy} style={{ border: 0, padding: 0, display: 'grid', gap: 16 }}>
        <legend>Что фактически произошло с товаром?</legend>
        <label><input type="radio" name="pickedDisposition" value="SHIP_WITH_WB_LABEL" required
          checked={disposition === 'SHIP_WITH_WB_LABEL'} onChange={() => setDisposition('SHIP_WITH_WB_LABEL')} />
          Этикетка WB уже наклеена — товар уезжает
        </label>
        <label><input type="radio" name="pickedDisposition" value="AWAIT_RETURN_RECEIPT" required
          checked={disposition === 'AWAIT_RETURN_RECEIPT'} onChange={() => setDisposition('AWAIT_RETURN_RECEIPT')} />
          Этикетки нет — товар отложен до повторной приёмки
        </label>
        <p>Отложенный товар станет доступным только после отдельной приёмки в бокс по ШК и КИЗ.</p>
        <label>Комментарий менеджера
          <textarea name="managerComment" required maxLength={1000} value={comment}
            onChange={event => setComment(event.target.value)} style={{ display: 'block', width: '100%', minHeight: 80 }} />
        </label>
        {props.error ? <p role="alert">{props.error}</p> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button type="submit" disabled={!managerDecisionReady(disposition, comment)}>{props.busy ? 'Сохраняю…' : 'Сохранить решение'}</button>
          <button type="button" onClick={props.onClose}>Отмена</button>
        </div>
      </fieldset>
    </form>
  </dialog>;
}
