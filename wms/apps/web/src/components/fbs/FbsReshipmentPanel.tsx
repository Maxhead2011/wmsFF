import { useEffect, useState } from 'react';
import { checkFbsReshipment, createFbsReshipment, fetchFbsReshipmentCapabilities, previewFbsReshipment,
  resumeFbsReshipment, type AuthSession, type FbsReshipmentCandidate, type FbsReshipmentMode,
  type FbsReshipmentPreview, type FbsReshipmentRun, type FbsReshipmentSelection } from '../../lib/api';

type ReshipmentApi = {
  check: (input: { clientId: string }) => Promise<{ candidates: FbsReshipmentCandidate[]; runs: FbsReshipmentRun[]; unverifiedCount?: number }>;
  preview: (input: FbsReshipmentSelection) => Promise<FbsReshipmentPreview>;
  create: (input: FbsReshipmentSelection & { previewToken: string; confirm: true }) => Promise<FbsReshipmentRun>;
  resume: (input: { clientId: string; runId: string }) => Promise<FbsReshipmentRun>;
};
type Filters = { query: string; connectionId: string; availability: 'ALL' | 'AVAILABLE' | 'REVIEW' };
type State = {
  candidates: FbsReshipmentCandidate[]; selected: FbsReshipmentCandidate[]; runs: FbsReshipmentRun[];
  mode: FbsReshipmentMode; preview: FbsReshipmentPreview | null; confirmed: boolean;
  busy: boolean; checked: boolean; error: string; filters: Filters; unverifiedCount: number;
};
const orderKey = (order: Pick<FbsReshipmentCandidate, 'id' | 'connectionId'>) => `${order.connectionId}:${order.id}`;

// FIX: scoped controller synchronously locks actions and discards obsolete async results.
export class FbsReshipmentController {
  state: State = { candidates: [], selected: [], runs: [], mode: 'SAME_ITEM', preview: null,
    confirmed: false, busy: false, checked: false, error: '',
    filters: { query: '', connectionId: '', availability: 'ALL' }, unverifiedCount: 0 };
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(private clientId: string, private api: ReshipmentApi) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  dispose() { this.disposed = true; this.listeners.clear(); }
  private update(patch: Partial<State>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener());
  }
  private async execute(work: () => Promise<void>, uncertainCreate = false) {
    if (this.disposed || this.state.busy) return;
    this.update({ busy: true, error: '' });
    try { await work(); }
    catch (error) { this.update({ error: `${error instanceof Error ? error.message : 'Не удалось выполнить операцию.'}${uncertainCreate ? ' Результат создания неизвестен. Нажмите «Проверить WB» и продолжите сохранённую операцию; не создавайте новую поставку вручную.' : ''}`,
      ...(uncertainCreate ? { preview: null, confirmed: false, selected: [], checked: false } : {}) }); }
    finally { this.update({ busy: false }); }
  }
  private eligible(order: FbsReshipmentCandidate) {
    return !order.blockedReason && order.eligibleModes.includes(this.state.mode);
  }
  canSelect(order: FbsReshipmentCandidate) {
    return this.eligible(order)
      && (!this.state.selected.length || this.state.selected[0].connectionId === order.connectionId);
  }
  // FIX: selection is always visible; any filter change invalidates the old preview.
  setFilters(patch: Partial<Filters>) {
    if (this.state.busy || this.disposed) return;
    this.update({ filters: { ...this.state.filters, ...patch }, selected: [], preview: null, confirmed: false, error: '' });
  }
  visibleCandidates() {
    const { query, connectionId, availability } = this.state.filters;
    const words = query.trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean);
    return this.state.candidates.filter(order => {
      if (connectionId && order.connectionId !== connectionId) return false;
      if (availability === 'AVAILABLE' && !this.eligible(order)) return false;
      if (availability === 'REVIEW' && this.eligible(order)) return false;
      const text = [order.id, order.sourceRequestNumber, order.sourceRequestNumber ? `№${order.sourceRequestNumber}` : '',
        order.sourceSupplyId, order.productName, order.article, order.barcode].join(' ').toLocaleLowerCase('ru');
      return words.every(word => text.includes(word));
    });
  }
  selectAllVisible() {
    if (!this.state.checked || this.state.busy || this.disposed) return;
    const rows = [...new Map(this.visibleCandidates().filter(order => this.eligible(order)).map(order => [orderKey(order), order])).values()];
    // FIX: never silently choose the first cabinet or truncate the requested set.
    const error = new Set(rows.map(order => order.connectionId)).size > 1 ? 'Выберите один кабинет WB в фильтре для массового выбора.' :
      rows.length > 100 ? `Найдено ${rows.length} доступных заказов. За одну операцию можно выбрать не более 100. Уточните фильтр или выберите заказы вручную.` : '';
    this.update({ ...(error ? {} : { selected: rows }), error, preview: null, confirmed: false });
  }
  clearSelection() {
    if (!this.state.busy && !this.disposed) this.update({ selected: [], preview: null, confirmed: false, error: '' });
  }
  toggle(order: FbsReshipmentCandidate) {
    if (this.state.busy || this.disposed) return;
    const selected = this.state.selected.some(item => orderKey(item) === orderKey(order));
    if (!selected && (!this.canSelect(order) || this.state.selected.length >= 100 || !this.visibleCandidates().some(item => orderKey(item) === orderKey(order)))) return;
    this.update({ selected: selected ? this.state.selected.filter(item => orderKey(item) !== orderKey(order)) : [...this.state.selected, order], preview: null, confirmed: false });
  }
  setMode(mode: FbsReshipmentMode) {
    if (this.state.busy || this.disposed) return;
    this.update({ mode, selected: [], preview: null, confirmed: false, error: '' });
  }
  confirm(confirmed: boolean) { if (!this.state.busy && this.state.preview) this.update({ confirmed }); }
  check() {
    return this.execute(async () => {
      this.update({ selected: [], preview: null, confirmed: false, candidates: [], checked: false, unverifiedCount: 0 });
      const result = await this.api.check({ clientId: this.clientId });
      this.update({ ...result, unverifiedCount: result.unverifiedCount ?? 0, checked: true });
    });
  }
  private selection(): FbsReshipmentSelection {
    return { clientId: this.clientId, mode: this.state.mode,
      orders: this.state.selected.map(({ id, connectionId }) => ({ id, connectionId })) };
  }
  preview() {
    if (!this.state.checked || !this.state.selected.length) return Promise.resolve();
    return this.execute(async () => {
      this.update({ preview: null, confirmed: false });
      const preview = await this.api.preview(this.selection()); this.update({ preview });
    });
  }
  create() {
    const proof = this.state.preview;
    if (!proof || !this.state.confirmed) return Promise.resolve();
    return this.execute(async () => {
      const result = await this.api.create({ ...this.selection(), previewToken: proof.previewToken, confirm: true });
      this.saveRun(result); this.update({ preview: null, confirmed: false, selected: [], candidates: [], checked: false });
    }, true);
  }
  resume(runId: string) {
    if (!this.state.runs.some(run => run.runId === runId && run.status !== 'CREATED')) return Promise.resolve();
    return this.execute(async () => { this.saveRun(await this.api.resume({ clientId: this.clientId, runId })); });
  }
  private saveRun(run: FbsReshipmentRun) { this.update({ runs: [run, ...this.state.runs.filter(item => item.runId !== run.runId)] }); }
}

// FIX: CLIENT always requires explicit own-client write scope, even with a mixed role.
export function canUseFbsReshipment(session: AuthSession, clientId: string) {
  const user = session.user;
  if (user.isDemo) return false;
  if (user.roleCodes.includes('CLIENT')) return user.permissionCodes.includes('client-requests:write')
    && user.clientIds.includes(clientId) && user.writableClientIds.includes(clientId);
  return user.roleCodes.some(role => role === 'ADMIN' || role === 'OWNER');
}

export function FbsReshipmentPanel(props: { session: AuthSession; clientId: string; onOpenRequest?: (id: string) => void }) {
  if (!canUseFbsReshipment(props.session, props.clientId)) return null;
  // FIX: remount all capabilities, responses and confirmation on account/client/branch changes.
  return <ScopedReshipmentPanel key={JSON.stringify([props.session.accessToken, props.session.user.id,
    props.session.user.activeWarehouseId, props.clientId, props.session.user.roleCodes,
    props.session.user.permissionCodes, props.session.user.clientIds, props.session.user.writableClientIds,
    props.session.user.warehouseIds, props.session.user.writableWarehouseIds])} {...props} />;
}
function ScopedReshipmentPanel({ session, clientId, onOpenRequest }: { session: AuthSession; clientId: string; onOpenRequest?: (id: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState<FbsReshipmentController | null>(null);
  // FIX: each effect lifetime owns a controller, including React StrictMode replay.
  useEffect(() => {
    const scopedModel = new FbsReshipmentController(clientId, {
      check: input => checkFbsReshipment(session.accessToken, input),
      preview: input => previewFbsReshipment(session.accessToken, input),
      create: input => createFbsReshipment(session.accessToken, input),
      resume: input => resumeFbsReshipment(session.accessToken, input),
    });
    setModel(scopedModel);
    return () => scopedModel.dispose();
  }, [clientId, session.accessToken]);
  useEffect(() => {
    let alive = true;
    void fetchFbsReshipmentCapabilities(session.accessToken).then(result => { if (alive) setEnabled(result.enabled); }).catch(() => { if (alive) setEnabled(false); });
    return () => { alive = false; };
  }, [session.accessToken]);
  return enabled && model ? <FbsReshipmentView model={model} onOpenRequest={onOpenRequest} /> : null;
}

export function FbsReshipmentView({ model, onOpenRequest }: { model: FbsReshipmentController; onOpenRequest?: (id: string) => void }) {
  const [, render] = useState(0);
  useEffect(() => model.subscribe(() => render(value => value + 1)), [model]);
  const state = model.state;
  const visible = model.visibleCandidates();
  const cabinets = [...new Set([...state.candidates.map(order => order.connectionId), state.filters.connectionId].filter(Boolean))].sort();
  return <section className="fbs-delivery-recovery" aria-label="Повторная отгрузка / довоз" aria-busy={state.busy}>
    <h4>Повторная отгрузка / довоз</h4>
    <p>Показываем только заказы, требующие повторной отгрузки или разбора. Завершённые и отменённые заказы WB скрыты. Проверка не меняет поставки, заявки, остатки и КИЗы.</p>
    <button type="button" className="button-secondary" disabled={state.busy} onClick={() => void model.check()}>Проверить WB</button>
    {state.busy && <p role="status">Выполняется операция…</p>}
    {state.error && <p role="alert" className="form-error">{state.error}</p>}
    {state.checked && <>
      {state.unverifiedCount > 0 && <p role="status">Статус WB не подтверждён: {state.unverifiedCount}. Эти заказы не включены в выбор. Повторите проверку WB.</p>}
      <fieldset disabled={state.busy}><legend>Что нужно сделать</legend>
        <label><input type="radio" name="reshipment-mode" checked={state.mode === 'SAME_ITEM'} onChange={() => model.setMode('SAME_ITEM')} />Довезти уже собранное</label>
        <label><input type="radio" name="reshipment-mode" checked={state.mode === 'NEW_ITEM'} onChange={() => model.setMode('NEW_ITEM')} />Собрать заново</label>
      </fieldset>
      <p>{state.mode === 'SAME_ITEM' ? 'Сохраняем прежние КИЗы и списание. Вторую вещь со склада брать не нужно.' : 'Внимание: новая физическая сборка — это дополнительное списание товара. Прежняя сборка остаётся в истории.'}</p>
      <p>За одну операцию — один кабинет WB, не более 100 заказов. Для другого кабинета создайте отдельную заявку.</p>
      <fieldset disabled={state.busy}><legend>Фильтры заказов</legend>
        <label>Поиск по заказу, заявке, поставке, ШК или товару
          <input type="search" value={state.filters.query} onChange={event => model.setFilters({ query: event.target.value })} />
        </label>
        <label>Кабинет WB
          <select aria-label="Кабинет WB" value={state.filters.connectionId} onChange={event => model.setFilters({ connectionId: event.target.value })}>
            <option value="">Все кабинеты</option>{cabinets.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label>Доступность для выбранного действия
          <select aria-label="Доступность для выбранного действия" value={state.filters.availability} onChange={event => model.setFilters({ availability: event.target.value as Filters['availability'] })}>
            <option value="ALL">Все требующие действий</option><option value="AVAILABLE">Доступны к созданию</option>
            <option value="REVIEW">Требуют разбора / недоступны для действия</option>
          </select>
        </label>
        <button type="button" className="button-secondary" onClick={() => model.setFilters({ query: '', connectionId: '', availability: 'ALL' })}>Сбросить фильтры</button>
      </fieldset>
      <p role="status">Показано: {visible.length} из {state.candidates.length}. Выбрано: {state.selected.length}.</p>
      <button type="button" className="button-secondary" disabled={state.busy || !visible.some(order => !order.blockedReason && order.eligibleModes.includes(state.mode))}
        onClick={() => model.selectAllVisible()}>Выбрать все доступные по фильтру</button>
      <button type="button" className="button-secondary" disabled={state.busy || !state.selected.length} onClick={() => model.clearSelection()}>Снять выбор</button>
      {!state.candidates.length ? <p role="status">Подтверждённых заказов для повторной отгрузки в выбранной области нет.</p> : !visible.length ? <p role="status">По выбранным фильтрам заказов нет.</p> :
        <div style={{ overflow: 'auto', maxHeight: 400 }} role="region" tabIndex={0} aria-label="Заказы WB для повторной отгрузки">
          <table><thead><tr><th>Выбор</th><th>Заказ / кабинет</th><th>Товар</th><th>Прежняя заявка / поставка</th><th>Сборка / WB</th><th>Ограничение</th></tr></thead>
            <tbody>{visible.map(order => <tr key={orderKey(order)}>
              <td><input type="checkbox" aria-label={`Выбрать заказ ${order.id} кабинета ${order.connectionId}`} checked={state.selected.some(item => orderKey(item) === orderKey(order))}
                disabled={state.busy || !model.canSelect(order)} onChange={() => model.toggle(order)} /></td>
              <td>{order.id}<br /><small>{order.connectionId}</small></td>
              <td>{order.productName}<br />{order.article} · {order.barcode}</td>
              <td>{order.sourceRequestNumber ? `№${order.sourceRequestNumber}` : 'Не найдена'}<br />{order.sourceSupplyId || 'Без поставки'}</td>
              <td>{order.assemblyStatus || 'Нет сборки'}<br />{order.supplierStatus} / {order.wbStatus}</td>
              <td>{order.blockedReason || (!order.eligibleModes.includes(state.mode) ? 'Недоступно для выбранного действия' : (!model.canSelect(order) ? 'Выбран другой кабинет WB' : 'Доступно'))}</td>
            </tr>)}</tbody></table>
        </div>}
      <button type="button" className="button-secondary" disabled={state.busy || !state.selected.length} onClick={() => void model.preview()}>Проверить выбранные · {state.selected.length}</button>
    </>}
    {state.preview && <div aria-live="polite">
      <p><strong>Заказов: {state.preview.orderCount}. Дополнительный расход: {state.preview.additionalUnits} ед.</strong></p>
      <p>{state.preview.warning}</p>
      <p>Будет создана новая поставка WB, выбранные заказы будут перенесены в неё с возвратом на сборку. Затем будет создана связанная заявка WMS.</p>
      <label><input type="checkbox" checked={state.confirmed} disabled={state.busy} onChange={event => model.confirm(event.target.checked)} />
        {state.mode === 'NEW_ITEM' ? 'Подтверждаю изменения в WB, создание заявки WMS и дополнительное списание товара при новой сборке' : 'Подтверждаю довоз уже собранного товара, изменения в WB и создание заявки WMS без повторного списания'}</label>
      <button type="button" className="button-primary" disabled={state.busy || !state.confirmed} onClick={() => void model.create()}>Создать поставку WB и заявку WMS</button>
    </div>}
    {state.runs.length > 0 && <div aria-label="Результаты повторной отгрузки">
      <h4>Сохранённые операции</h4>
      {state.runs.map(run => <div key={run.runId}>
        <p>{run.mode === 'SAME_ITEM' ? 'Довоз собранного' : 'Новая сборка'} · {run.status === 'CREATED' ? 'Заявка создана' : 'Требуется продолжение проверки'}<br />
          Поставка: {run.supplyId || 'Пока не подтверждена'} · Заявка: {run.requestNumber ? `№${run.requestNumber}` : 'Пока не создана'}</p>
        {run.errorMessage && <p role="alert">{run.errorMessage}</p>}
        {run.requestId && onOpenRequest && <button type="button" className="button-secondary" onClick={() => onOpenRequest(run.requestId!)}>Открыть заявку</button>}
        {run.status !== 'CREATED' && <button type="button" className="button-secondary" disabled={state.busy} onClick={() => void model.resume(run.runId)}>Проверить и продолжить сохранённую операцию</button>}
      </div>)}
    </div>}
  </section>;
}
