import { useEffect, useState } from 'react';
import { checkFbsReshipment, createFbsReshipment, fetchFbsReshipmentCapabilities, previewFbsReshipment,
  resumeFbsReshipment, type AuthSession, type FbsReshipmentCandidate, type FbsReshipmentMode,
  type FbsReshipmentPreview, type FbsReshipmentRun, type FbsReshipmentSelection } from '../../lib/api';

type ReshipmentApi = {
  check: (input: { clientId: string }) => Promise<{ candidates: FbsReshipmentCandidate[]; runs: FbsReshipmentRun[] }>;
  preview: (input: FbsReshipmentSelection) => Promise<FbsReshipmentPreview>;
  create: (input: FbsReshipmentSelection & { previewToken: string; confirm: true }) => Promise<FbsReshipmentRun>;
  resume: (input: { clientId: string; runId: string }) => Promise<FbsReshipmentRun>;
};
type State = {
  candidates: FbsReshipmentCandidate[]; selected: FbsReshipmentCandidate[]; runs: FbsReshipmentRun[];
  mode: FbsReshipmentMode; preview: FbsReshipmentPreview | null; confirmed: boolean;
  busy: boolean; checked: boolean; error: string;
};
const orderKey = (order: Pick<FbsReshipmentCandidate, 'id' | 'connectionId'>) => `${order.connectionId}:${order.id}`;

// FIX: scoped controller synchronously locks actions and discards obsolete async results.
export class FbsReshipmentController {
  state: State = { candidates: [], selected: [], runs: [], mode: 'SAME_ITEM', preview: null,
    confirmed: false, busy: false, checked: false, error: '' };
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
  canSelect(order: FbsReshipmentCandidate) {
    return !order.blockedReason && order.eligibleModes.includes(this.state.mode)
      && (!this.state.selected.length || this.state.selected[0].connectionId === order.connectionId);
  }
  toggle(order: FbsReshipmentCandidate) {
    if (this.state.busy || this.disposed) return;
    const selected = this.state.selected.some(item => orderKey(item) === orderKey(order));
    if (!selected && (!this.canSelect(order) || this.state.selected.length >= 100 || !this.state.candidates.some(item => orderKey(item) === orderKey(order)))) return;
    this.update({ selected: selected ? this.state.selected.filter(item => orderKey(item) !== orderKey(order)) : [...this.state.selected, order], preview: null, confirmed: false });
  }
  setMode(mode: FbsReshipmentMode) {
    if (this.state.busy || this.disposed) return;
    this.update({ mode, selected: this.state.selected.filter(order => order.eligibleModes.includes(mode)), preview: null, confirmed: false });
  }
  confirm(confirmed: boolean) { if (!this.state.busy && this.state.preview) this.update({ confirmed }); }
  check() {
    return this.execute(async () => {
      this.update({ selected: [], preview: null, confirmed: false, candidates: [], checked: false });
      const result = await this.api.check({ clientId: this.clientId });
      this.update({ ...result, checked: true });
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

export function FbsReshipmentPanel(props: { session: AuthSession; clientId: string; onOpenRequest?: (id: string) => void }) {
  if (!props.session.user.roleCodes.some(role => role === 'ADMIN' || role === 'OWNER')) return null;
  // FIX: remount all capabilities, responses and confirmation on account/client/branch changes.
  return <ScopedReshipmentPanel key={JSON.stringify([props.session.accessToken, props.session.user.id,
    props.session.user.activeWarehouseId, props.clientId, props.session.user.roleCodes])} {...props} />;
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
  return <section className="fbs-delivery-recovery" aria-label="Повторная отгрузка / довоз" aria-busy={state.busy}>
    <h4>Повторная отгрузка / довоз</h4>
    <p>Проверка получает специальный список WB для повторной отгрузки. Она не меняет поставки, заявки, остатки и КИЗы.</p>
    <button type="button" className="button-secondary" disabled={state.busy} onClick={() => void model.check()}>Проверить WB</button>
    {state.busy && <p role="status">Выполняется операция…</p>}
    {state.error && <p role="alert" className="form-error">{state.error}</p>}
    {state.checked && <>
      <fieldset disabled={state.busy}><legend>Что нужно сделать</legend>
        <label><input type="radio" name="reshipment-mode" checked={state.mode === 'SAME_ITEM'} onChange={() => model.setMode('SAME_ITEM')} />Довезти уже собранное</label>
        <label><input type="radio" name="reshipment-mode" checked={state.mode === 'NEW_ITEM'} onChange={() => model.setMode('NEW_ITEM')} />Собрать заново</label>
      </fieldset>
      <p>{state.mode === 'SAME_ITEM' ? 'Сохраняем прежние КИЗы и списание. Вторую вещь со склада брать не нужно.' : 'Внимание: новая физическая сборка — это дополнительное списание товара. Прежняя сборка остаётся в истории.'}</p>
      <p>За одну операцию — один кабинет WB, не более 100 заказов. Для другого кабинета создайте отдельную заявку.</p>
      {!state.candidates.length ? <p role="status">WB не вернул заказов для повторной отгрузки в выбранной области.</p> :
        <div style={{ overflow: 'auto', maxHeight: 400 }} role="region" tabIndex={0} aria-label="Заказы WB для повторной отгрузки">
          <table><thead><tr><th>Выбор</th><th>Заказ / кабинет</th><th>Товар</th><th>Прежняя заявка / поставка</th><th>Сборка / WB</th><th>Ограничение</th></tr></thead>
            <tbody>{state.candidates.map(order => <tr key={orderKey(order)}>
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
