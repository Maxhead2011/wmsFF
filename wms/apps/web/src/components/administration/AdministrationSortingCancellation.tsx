import { useEffect, useRef, useState } from 'react';
import type { AuthSession } from '../../lib/api';
import { sortingRequest, SortingHttpError, type SortingState } from '../../lib/pallet-sorting-api';

// FIX: role and installation gates match the sorting API, including limited administration accounts.
export const canCancelSorting = (session: AuthSession) => import.meta.env.VITE_PALLET_SORTING_ENABLED === 'true'
  && !session.user.isDemo && session.user.roleCodes.some(r => r === 'ADMIN' || r === 'OWNER');
export function cancellationBlock(state: SortingState) {
  return state.moves.length || state.targets.length || state.activeTargetId || state.pendingRoutes.length || state.sources.some(b => b.archived)
    ? 'Есть перемещения, целевые короба, архивирование или незавершённые маршруты. Требуется отдельная проверка.' : '';
}
export function AdministrationSortingCancellation({ session, embedded = false }: { session: AuthSession; embedded?: boolean }) {
  const [open, setOpen] = useState(embedded), [rows, setRows] = useState<SortingState[]>([]);
  const [selected, setSelected] = useState<SortingState | null>(null), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const gate = useRef(false);
  const [pending, setPending] = useState<{ id: string; body: Record<string, unknown> } | null>(null);
  const run = async (fn: () => Promise<void>) => {
    if (gate.current) return; gate.current = true; setBusy(true); setMessage('');
    try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось выполнить действие'); }
    finally { gate.current = false; setBusy(false); }
  };
  const refresh = async () => setRows(await sortingRequest<SortingState[]>(session.accessToken));
  const submit = () => void run(async () => {
    if (!pending && (!selected || !reason.trim() || !confirmed)) return;
    const request = pending ?? { id: selected!.id, body: { action: 'CANCEL_EMPTY', version: selected!.version, operationId: crypto.randomUUID(), reason: reason.trim() } };
    setPending(request);
    try { await sortingRequest(session.accessToken, `/${request.id}/actions`, request.body); }
    catch (e) {
      if (e instanceof SortingHttpError && e.status >= 400 && e.status < 500) { setPending(null); setSelected(null); await refresh(); }
      throw e;
    }
    setPending(null); setSelected(null); setReason(''); setConfirmed(false);
    setRows(current => current.filter(r => r.id !== request.id));
    setMessage('Сортировка снята. Остатки, КИЗы и размещение сохранены.');
  });
  // FIX: the selected tile opens content directly; no blank collapsed card.
  useEffect(() => { if (embedded && canCancelSorting(session)) void run(refresh); }, [embedded, session.accessToken, session.user.activeWarehouseId]);
  if (!canCancelSorting(session)) return null;
  return <section className={embedded ? 'admin-sorting-content' : 'admin-card'} aria-label="Снятие незавершённых сортировок">
    {!embedded && <button type="button" disabled={busy || !!pending} onClick={() => { if (open) { setOpen(false); return; } setOpen(true); void run(refresh); }}>Незавершённые сортировки</button>}
    {open && <>
      <h3>Снятие незавершённой сортировки</h3>
      <p>Только текущий филиал. Снять можно сессию без перемещений и целевых коробов. Товар остаётся на своих местах.</p>
      <button type="button" disabled={busy || !!pending} onClick={() => void run(refresh)}>Обновить список</button>
      {!busy && !rows.length && <p>Незавершённых сортировок нет.</p>}
      {rows.map(row => <article key={row.id}>
        <h4>{row.sourceCode}</h4><p>Исходных коробов: {row.sources.length} · Перемещений: {row.moves.length} · Целевых коробов: {row.targets.length}</p>
        <p>{row.sources.map(b => b.code).join(', ')}</p>
        {cancellationBlock(row) ? <p>{cancellationBlock(row)}</p> : <button type="button" disabled={busy || !!pending} onClick={() => { setSelected(row); setReason(''); setConfirmed(false); }}>Снять сортировку</button>}
      </article>)}
      {selected && <fieldset disabled={busy || !!pending}>
        <legend>Снять: {selected.sourceCode}</legend>
        <label className="admin-field"><span>Причина</span><textarea maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Подтверждаю снятие этой сортировки без изменения остатков</label>
        <button type="button" disabled={!reason.trim() || !confirmed} onClick={submit}>Подтвердить снятие</button>
        <button type="button" onClick={() => setSelected(null)}>Отмена</button>
      </fieldset>}
      {pending && !busy && <div role="alert"><p>Ответ не подтверждён. Повтор использует тот же номер операции.</p><button type="button" onClick={submit}>Проверить результат / повторить</button></div>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
