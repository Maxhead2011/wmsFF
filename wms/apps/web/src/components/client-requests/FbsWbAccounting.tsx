import { useEffect, useRef, useState } from 'react';
import type { FbsWbAccountingView } from '../../lib/api';
import type { WbAccountingBatchHandler, WbAccountingResult } from '../../lib/fbs-wb-accounting-batch';

type Candidate = FbsWbAccountingView['candidates'][number];
export const wbAccountingCommentReady = (comment: string) => comment.trim().length >= 3 && comment.trim().length <= 1000;

// FIX: manager accounting is shown separately from scanned physical completions.
export function FbsWbAccounting({ data, busy, error, onAccount, onAccountMany, canShip = false }: {
  data?: FbsWbAccountingView; busy: boolean; error?: string;
  canShip?: boolean;
  onAccount?: (assemblyId: string, orderId: string, comment: string) => Promise<boolean>;
  onAccountMany?: WbAccountingBatchHandler;
}) {
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batch, setBatch] = useState<Candidate[] | null>(null);
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [results, setResults] = useState<WbAccountingResult[]>([]);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [batchError, setBatchError] = useState<string>();
  const selectable = (data?.enabled && onAccountMany ? data.candidates : []).filter(row =>
    (!row.kiz || !row.barcode || canShip) && !completedIds.includes(row.id));
  const selectedOrders = selectable.filter(row => selectedIds.includes(row.id));
  const retryOrders = selectable.filter(row => results.some(result => result.id === row.id && !result.accounted));
  const locked = busy || running;
  useEffect(() => {
    const allowed = new Set((data?.enabled ? data.candidates : []).filter(row => !row.kiz || !row.barcode || canShip).map(row => row.id));
    setSelectedIds(current => current.every(id => allowed.has(id)) ? current : current.filter(id => allowed.has(id)));
  }, [data, canShip]);
  if (!data) return null;
  return <>
    {data.enabled && (onAccount || onAccountMany) && data.candidates.length > 0 && <section className="online-execution-section">
      <h4>Обработаны WB — требуется решение</h4>
      <p>При подтверждении WMS проверит свежий статус WB. Заказ с привязанной парой КИЗ–ШК будет списан со склада и записан в историю отгрузок.</p>
      {/* FIX: bulk selection includes only orders the manager may confirm. */}
      {onAccountMany && selectable.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '12px 0' }}>
        <label><input type="checkbox" disabled={locked} checked={selectedOrders.length === selectable.length}
          ref={node => { if (node) node.indeterminate = selectedOrders.length > 0 && selectedOrders.length < selectable.length; }}
          onChange={event => setSelectedIds(event.target.checked ? selectable.map(row => row.id) : [])} /> Выбрать все доступные ({selectable.length})</label>
        <button type="button" disabled={locked || selectedOrders.length === 0} onClick={() => { setBatchError(undefined); setBatch([...selectedOrders]); }}>
          Принять решение по выбранным ({selectedOrders.length})</button>
      </div>}
      {data.candidates.filter(row => !completedIds.includes(row.id)).map(row => <div key={row.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 0' }}>
        {onAccountMany && selectable.some(candidate => candidate.id === row.id) && <input type="checkbox" aria-label={`Выбрать заказ №${row.orderId}`}
          disabled={locked} checked={selectedIds.includes(row.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} />}
        <span><strong>№{row.orderId} · {row.productName}</strong><br />WB: {row.wbStatus}
          {row.kiz && row.barcode && <><br />КИЗ: {row.kiz} · ШК: {row.barcode}</>}</span>
        {onAccount && (!row.kiz || !row.barcode || canShip) && <button type="button" disabled={locked} onClick={() => setSelected(row)}>{row.kiz && row.barcode ? 'Подтвердить отгрузку по WB' : 'Учесть по статусу WB'}</button>}
      </div>)}
    </section>}
    {results.length > 0 && <section className="online-execution-section" aria-label="Результат общего решения" aria-live="polite">
      <h4>Подтверждено: {results.filter(row => row.accounted).length} из {results.length}</h4>
      <p>Результат сохраняется отдельно для каждого заказа.</p>
      <ul>{results.map(row => <li key={row.id}>№{row.orderId}: {row.accounted ? 'Подтверждено' : `Результат не подтверждён — ${row.error}`}</li>)}</ul>
      {onAccountMany && retryOrders.length > 0 && <button type="button" disabled={locked} onClick={() => { setBatchError(undefined); setBatch([...retryOrders]); }}>
        Проверить неподтверждённые ({retryOrders.length})</button>}
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
    {batch && onAccountMany && <FbsWbAccountingBatchDialog orders={batch} busy={locked} progress={running ? progress : undefined} error={batchError}
      onClose={() => { if (!inFlight.current) setBatch(null); }} onSubmit={async comment => {
        if (inFlight.current) return;
        if (batch.some(row => !selectable.some(current => current.id === row.id && current.kiz === row.kiz && current.barcode === row.barcode))) {
          setBatchError('Список заказов или права изменились. Закройте окно и выберите заказы заново.'); return;
        }
        inFlight.current = true; setRunning(true); setBatchError(undefined); setProgress({ completed: 0, total: batch.length });
        try {
          const next = await onAccountMany(batch, comment, (completed, total) => setProgress({ completed, total }));
          setResults(next);
          setCompletedIds(current => [...new Set([...current, ...next.filter(row => row.accounted).map(row => row.id)])]);
          setSelectedIds(next.filter(row => !row.accounted).map(row => row.id));
          setBatch(null);
        } catch (caught) {
          setBatchError(caught instanceof Error ? caught.message : 'Не удалось подтвердить результат. Обновите заявку.');
        } finally { inFlight.current = false; setRunning(false); }
      }} />}
  </>;
}

// FIX: one explicit confirmation describes both stock write-offs and no-pair accounting.
export function FbsWbAccountingBatchDialog({ orders, busy, progress, error, onSubmit, onClose }: {
  orders: Candidate[]; busy: boolean; progress?: { completed: number; total: number }; error?: string;
  onSubmit: (comment: string) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null); const submitting = useRef(false);
  const [comment, setComment] = useState('');
  const paired = orders.filter(row => row.kiz && row.barcode).length;
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} aria-label="Общее решение по заказам WB" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    style={{ width: 'min(680px, calc(100vw - 32px))', maxHeight: '85vh', overflow: 'auto', borderRadius: 12, padding: 24, border: '1px solid #b8c0cc' }}>
    <h3>Общее решение по WB · {orders.length} заказов</h3>
    {paired > 0 && <p>Списание по КИЗ–ШК: <strong>{paired} ед.</strong> Отгрузка каждой пары сохранится в истории. Если источник не подтверждён, будет указано «Без короба».</p>}
    {orders.length > paired && <p>Заказов для учёта без складского списания: <strong>{orders.length - paired}</strong>.</p>}
    <p>WMS проверит актуальный статус каждого заказа. Отказ по одному заказу не отменяет уже подтверждённые решения.</p>
    <ul style={{ maxHeight: 210, overflow: 'auto', overflowWrap: 'anywhere' }}>{orders.map(row => <li key={row.id}>
      №{row.orderId} · {row.productName}{row.kiz && row.barcode ? <><br />КИЗ: {row.kiz} · ШК: {row.barcode}</> : ' · без списания'}
    </li>)}</ul>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || submitting.current || !orders.length || !wbAccountingCommentReady(comment)) return;
      submitting.current = true; try { await onSubmit(comment.trim()); } finally { submitting.current = false; }
    }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
        <label>Общий комментарий менеджера<textarea name="wbAccountingBatchComment" required minLength={3} maxLength={1000} value={comment}
          onChange={event => setComment(event.target.value)} style={{ display: 'block', width: '100%', minHeight: 90 }} /></label>
        {error && <p role="alert">{error}</p>}
        {progress && <p role="status">Обработано {progress.completed} из {progress.total}</p>}
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button type="submit" disabled={!orders.length || !wbAccountingCommentReady(comment)}>{busy ? 'Обрабатываю заказы…' : 'Подтвердить общее решение'}</button>
          <button type="button" onClick={onClose}>Отмена</button>
        </div>
      </fieldset>
    </form>
  </dialog>;
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
