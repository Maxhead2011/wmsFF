import React, { useEffect, useRef, useState } from 'react';
import type { AuthSession } from '../../lib/api';
import { sortingRequest, SortingHttpError, type SortingPreview, type SortingState } from '../../lib/pallet-sorting-api';
import './pallet-sorting.css';

// ADDED: a single screen guides source verification, destinations and final shortage consent.
export function PalletSortingPanel({ session }: { session: AuthSession }) {
  if (!session.user.roleCodes.includes('ADMIN')) return <p>Раздел доступен только администратору.</p>;
  return <SortingWorkspace key={`${session.user.id}:${session.user.activeWarehouseId}`} session={session} />;
}

// FIX: a physical box without WMS stock is a visible discrepancy, not a normal source.
export function SortingProblemSummary({ problems = [], recovered }: { problems?: SortingState['problemSources']; recovered: number }) {
  if (!problems.length && !recovered) return null;
  return <aside aria-label="Проблемные короба">
    <h3>Проблемные короба ({problems.length})</h3>
    <ul>{problems.map(b => <li key={b.code}>{b.code} — не найден в WMS · {b.scanned ? 'отсканирован' : 'не отсканирован'}</li>)}</ul>
    <p>{`Оприходовано найденных: ${recovered} ед.`} Это отдельная корректировка остатка, а не списание из неизвестного короба.</p>
  </aside>;
}

function SortingWorkspace({ session }: { session: AuthSession }) {
  const [state, setState] = useState<SortingState | null>(null);
  const [sessions, setSessions] = useState<SortingState[]>([]);
  const [busy, setBusy] = useState(false);
  const gate = useRef(false);
  const [message, setMessage] = useState('');
  const [scan, setScan] = useState('');
  const [barcode, setBarcode] = useState('');
  const [source, setSource] = useState('');
  const [pallet, setPallet] = useState('');
  const [preview, setPreview] = useState<{ data: SortingPreview; action: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<{ path: string; body: Record<string, unknown> } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const token = session.accessToken;
  const loadList = async () => setSessions(await sortingRequest<SortingState[]>(token));
  useEffect(() => {
    mounted.current = true;
    void loadList().catch(e => { if (mounted.current) setMessage(e.message); });
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (!busy && !preview) input.current?.focus(); }, [busy, state?.version, barcode, preview]);
  useEffect(() => {
    // FIX: native modality prevents keyboard or pointer actions behind destructive consent.
    if (preview && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [preview]);
  const run = async (fn: () => Promise<void>) => {
    if (gate.current) return;
    gate.current = true; setBusy(true); setMessage('');
    try { await fn(); } catch (e) { if (mounted.current) setMessage(e instanceof Error ? e.message : 'Ошибка операции.'); }
    finally { gate.current = false; if (mounted.current) setBusy(false); }
  };
  const acceptState = async (next: SortingState) => {
    if (!mounted.current) return;
    setState(next);
    if (next.pendingRoutes.length) {
      const rebuilt = await sortingRequest<SortingState>(token, `/${next.id}/routes`, {});
      if (mounted.current) setState(rebuilt);
    }
  };
  const send = (path: string, body: Record<string, unknown>) => run(async () => {
    setPending({ path, body });
    let next: SortingState;
    try { next = await sortingRequest<SortingState>(token, path, body); }
    catch (e) {
      if (e instanceof SortingHttpError && e.status >= 400 && e.status < 500) {
        setPending(null);
        if (state) setState(await sortingRequest<SortingState>(token, `/${state.id}`));
      }
      throw e;
    }
    setPending(null); setPreview(null); setBarcode(''); setScan('');
    await acceptState(next);
    setMessage('Действие сохранено.');
  });
  const action = (name: string, extra: Record<string, unknown> = {}) => {
    if (!state || pending) return;
    void send(`/${state.id}/actions`, { operationId: crypto.randomUUID(), version: state.version, action: name, ...extra });
  };
  const submitScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (gate.current || pending || !scan.trim()) return;
    const value = scan.trim(); setScan('');
    if (!state) { void send('', { id: crypto.randomUUID(), code: value }); return; }
    if (state.stage === 'CHECKING') { action('SCAN_SOURCE', { code: value }); return; }
    if (!state.activeTargetId) { action('OPEN_TARGET', { code: value, palletCode: pallet }); return; }
    if (!barcode) { setBarcode(value); return; }
    action('MOVE', { barcode, kiz: value, ...(source ? { sourceBoxCode: source } : {}) });
  };
  const inspect = (name: string) => run(async () => {
    const data = await sortingRequest<SortingPreview>(token, `/${state!.id}/preview?kind=${name === 'ARCHIVE_MISSING' ? 'missing' : 'remaining'}`);
    setConsent(false); setPreview({ data, action: name });
  });
  // FIX: a preserved permanent box is settled, not archived or still missing.
  const missing = state?.sources.filter(b => !b.scanned && !b.archived && !b.preservedOnPallet) ?? [];
  const target = state?.targets.find(b => b.id === state.activeTargetId);
  const hint = !state ? 'Паллет-сорт или короб' : state.stage === 'CHECKING' ? 'Исходный короб на паллет-сорте' : !target ? 'Новый целевой короб' : !barcode ? 'ШК товара' : 'КИЗ товара';

  return <section className="pallet-sorting" aria-label="Сортировка и перемещение">
    <h2>Сортировка и перемещение</h2>
    <p>Только администратор. Это не отгрузка FBS. Учтённый товар перемещается без увеличения остатка. Товар из неизвестного короба по ШК + новому КИЗ учитывается отдельно как найденный.</p>
    {message && <p role="status">{message}</p>}
    {pending && !busy && !preview && <div role="alert"><p>Результат запроса пока не подтверждён. Повтор безопасен: используется тот же номер операции.</p><button onClick={() => void send(pending.path, pending.body)}>Повторить тот же запрос</button></div>}
    <fieldset disabled={busy || Boolean(pending) || Boolean(preview)}>
      {!state && sessions.length > 0 && <div><h3>Продолжить незавершённую сортировку</h3>{sessions.map(row => <button key={row.id} onClick={() => void run(async () => acceptState(await sortingRequest<SortingState>(token, `/${row.id}`)))}>{row.sourceCode} · {row.moves.length} ед.</button>)}</div>}
      {state && <>
        <h3>{state.sourceCode} · {state.stage === 'CHECKING' ? 'Сверка коробов' : state.stage === 'FORMING' ? 'Формирование новых коробов' : 'Сортировка завершена'}</h3>
        <p>Обработано: {state.moves.length} ед. · Перемещено: {state.moves.filter(m => !m.recovered).length} ед. · Целевых коробов: {state.targets.length}</p>
        <SortingProblemSummary problems={state.problemSources} recovered={state.moves.filter(m => m.recovered).length} />
        {state.pendingRoutes.length > 0 && <div role="alert"><p>Остатки сохранены, но перестроение FBS-маршрутов ещё не завершено.</p>{state.pendingRoutes.map(p => <p key={p.requestId}>{p.taskIds.length} заданий: {p.error ?? 'ожидают перестроения'}</p>)}<button onClick={() => void run(async () => setState(await sortingRequest<SortingState>(token, `/${state.id}/routes`, {})))}>Повторить перестроение маршрутов</button></div>}
        <details><summary>Исходные короба ({state.sources.length})</summary><ul>{state.sources.map(box => <li key={box.id}>{box.code} — {box.preservedOnPallet ? 'пустой бокс · сохранён на месте' : box.archived ? 'архив' : box.scanned ? 'подтверждён' : 'не отсканирован'}</li>)}</ul></details>
      </>}
      {state?.stage === 'FORMING' && !target && <label>Фактический паллет-сорт целевого короба<input value={pallet} onChange={e => setPallet(e.target.value)} placeholder="Отсканируйте паллет-сорт" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); input.current?.focus(); } }} /></label>}
      {target && <><h3>Заполняется {target.code} · {target.quantity} ед.</h3><label>Исходный короб — если КИЗ ещё не привязан<input list="sorting-source-codes" value={source} onChange={e => setSource(e.target.value)} placeholder="Отсканируйте короб; неизвестный отметим как проблемный" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); input.current?.focus(); } }} /><datalist id="sorting-source-codes">{state!.sources.filter(b => b.scanned && !b.archived && !b.preservedOnPallet).map(b => <option key={b.id} value={b.code} />)}{state!.problemSources?.filter(b => b.scanned).map(b => <option key={b.code} value={b.code}>Проблемный</option>)}</datalist></label></>}
      {state?.stage !== 'COMPLETED' && <form onSubmit={submitScan}><label>{hint}<input ref={input} value={scan} onChange={e => setScan(e.target.value)} autoComplete="off" aria-label={hint} /></label>{barcode && <p>ШК: {barcode} <button type="button" onClick={() => { setBarcode(''); setScan(''); }}>Отменить текущую единицу</button></p>}<button type="submit">{!state ? 'Начать сортировку' : 'Подтвердить скан'}</button></form>}
      {state?.stage === 'CHECKING' && <div className="pallet-sorting-actions">{missing.length > 0 && <button onClick={() => void inspect('ARCHIVE_MISSING')}>Расхождения по коробам: {missing.length}</button>}<button disabled={missing.length > 0} onClick={() => action('BEGIN_FORMING')}>Приступить к формированию новых коробов</button></div>}
      {state?.stage === 'FORMING' && <div className="pallet-sorting-actions"><button disabled={!target || Boolean(barcode)} onClick={() => action('CLOSE_TARGET')}>Закрыть короб</button><button disabled={Boolean(target) || Boolean(barcode)} onClick={() => void inspect('COMPLETE')}>Завершить сортировку</button></div>}
      {state && <details><summary>Целевые короба</summary><ul>{state.targets.map(b => <li key={b.id}>{b.code}: {b.quantity} ед. · {b.palletCode} · {b.closed ? 'закрыт' : 'заполняется'}</li>)}</ul></details>}
      {state && <button disabled={Boolean(barcode)} onClick={() => void run(async () => { setState(null); setPreview(null); setScan(''); await loadList(); })}>К списку сортировок</button>}
    </fieldset>
    {preview && <dialog ref={dialog} aria-label="Подтверждение расхождений" className="pallet-sorting-confirm" onCancel={e => { e.preventDefault(); if (!busy && !pending) setPreview(null); }}>
      {/* FIX: a lost write-off response must be recoverable inside the active modal. */}
      {message && <p role="alert">{message}</p>}
      {pending && !busy && <div><p>Результат списания пока не подтверждён. Повторяем ту же операцию без повторного списания.</p><button onClick={() => void send(pending.path, pending.body)}>Повторить тот же запрос</button></div>}
      <h3>Проверка перед завершением</h3><p>Коробов: {preview.data.boxes.length}. К списанию: <strong>{preview.data.quantity} ед.</strong></p>
      <SortingProblemSummary problems={preview.data.problemSources} recovered={preview.data.recoveredQuantity ?? 0} />
      <p>Постоянных боксов: {preview.data.boxes.filter(b => b.preserveOnPallet).length} — останутся активными на своих местах. Обычных коробов: {preview.data.boxes.filter(b => !b.preserveOnPallet).length} — будут архивированы.</p>
      <div className="pallet-sorting-table"><table><thead><tr><th>Короб</th><th>Артикул / товар</th><th>Размер</th><th>Цвет</th><th>К списанию</th></tr></thead><tbody>{preview.data.boxes.map(b => b.balances.length ? b.balances.map(r => <tr key={r.id}><td>{b.code}</td><td>{r.sku.article || r.sku.name}</td><td>{r.sku.size}</td><td>{r.sku.color}</td><td>{r.quantity}</td></tr>) : <tr key={b.id}><td>{b.code}</td><td colSpan={4}>Пустой короб</td></tr>)}</tbody></table></div>
      <p>Будет проверено маршрутов FBS: {preview.data.affectedOrders.length}. История КИЗ сохранится.</p>
      {preview.data.quantity > 0 && <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />Подтверждаю отсутствие перечисленного товара и его списание</label>}
      <button disabled={busy || Boolean(pending) || preview.data.quantity > 0 && !consent} onClick={() => action(preview.action, { fingerprint: preview.data.fingerprint, confirmWriteOff: consent })}>Применить решение{preview.data.quantity > 0 ? ' и списать недостачу' : ''}</button>
      <button disabled={busy || Boolean(pending)} onClick={() => setPreview(null)}>Отмена — ничего не списывать</button>
    </dialog>}
  </section>;
}
