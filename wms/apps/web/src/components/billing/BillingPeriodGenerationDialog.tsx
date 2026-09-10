import { useRef, useState, type KeyboardEvent } from 'react';
import { generateBillingPeriod, previewBillingPeriod, type AuthSession, type BillingServiceCategory, type ClientSummary } from '../../lib/api';

type Props = {
  session: AuthSession;
  clients: ClientSummary[];
  clientId?: string;
  periodFrom: string;
  periodTo: string;
  onClose(): void;
  onCreated(): void;
};
const categoryLabels: Record<BillingServiceCategory, string> = {
  FBS: 'FBS', PROCESSING: 'Первичная обработка', PRR: 'ПРР', STORAGE: 'Хранение', OTHER: 'Прочие услуги',
};
// FIX: unresolved OTHER remains a registry label, not a supported generation category.
const generationCategories: BillingServiceCategory[] = ['FBS', 'PROCESSING', 'PRR', 'STORAGE'];
type Preview = Awaited<ReturnType<typeof previewBillingPeriod>>;
type Generated = Awaited<ReturnType<typeof generateBillingPeriod>>;

function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

// FIX: inclusive calendar periods independent of the browser timezone and DST.
export function billingPeriodPreset(start: string, preset: 'week' | 'fortnight' | 'month') {
  const from = parseCalendarDate(start);
  if (!from) return null;
  const to = new Date(from);
  if (preset === 'month') {
    from.setUTCDate(1);
    to.setUTCMonth(to.getUTCMonth() + 1, 0);
  } else {
    to.setUTCDate(to.getUTCDate() + (preset === 'week' ? 6 : 13));
  }
  return { periodFrom: from.toISOString().slice(0, 10), periodTo: to.toISOString().slice(0, 10) };
}

// ADDED: preview/confirmation uses existing server billing rules, never a local tariff calculation.
export function BillingPeriodGenerationDialog(props: Props) {
  const [clientId, setClientId] = useState(props.clientId ?? '');
  const [periodFrom, setPeriodFrom] = useState(props.periodFrom);
  const [periodTo, setPeriodTo] = useState(props.periodTo);
  const [categories, setCategories] = useState<BillingServiceCategory[]>(['FBS', 'PROCESSING', 'PRR', 'STORAGE']);
  const [excludeLukin, setExcludeLukin] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [created, setCreated] = useState<Generated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestLock = useRef(false);
  const currentPreviewHash = useRef<string | null>(null);

  function invalidate() {
    currentPreviewHash.current = null;
    setPreview(null);
    setCreated(null);
    setError(null);
  }
  function input() {
    return { ...(clientId ? { clientId } : {}), periodFrom, periodTo, categories, excludeLukin };
  }
  function preset(value: 'week' | 'fortnight' | 'month') {
    if (requestLock.current) return;
    const dates = billingPeriodPreset(periodFrom, value);
    invalidate();
    if (!dates) { setError('Проверьте даты: укажите корректную начальную дату.'); return; }
    setPeriodFrom(dates.periodFrom);
    setPeriodTo(dates.periodTo);
  }
  async function calculate() {
    if (requestLock.current) return;
    invalidate();
    if (!parseCalendarDate(periodFrom) || !parseCalendarDate(periodTo) || periodFrom > periodTo) {
      setError('Проверьте даты: начало периода должно быть не позднее окончания.'); return;
    }
    if (!categories.length) { setError('Выберите хотя бы один вид услуг.'); return; }
    requestLock.current = true;
    setBusy(true);
    try {
      const result = await previewBillingPeriod(props.session.accessToken, input());
      currentPreviewHash.current = result.previewHash;
      setPreview(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось рассчитать счета. Попробуйте получить новый расчёт.');
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    // FIX: ref closes the same-tick double-click window; the server verifies this exact preview hash.
    if (requestLock.current || !preview?.groups.length || currentPreviewHash.current !== preview.previewHash) return;
    requestLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await generateBillingPeriod(props.session.accessToken, { ...input(), previewHash: preview.previewHash });
      currentPreviewHash.current = null;
      setPreview(null);
      setCreated(result);
      props.onCreated();
    } catch (caught) {
      // FIX: do not silently retry a financial operation against a changed selection.
      currentPreviewHash.current = null;
      setPreview(null);
      setError(`${caught instanceof Error ? caught.message : 'Не удалось подтвердить формирование счетов.'} Получите новый предварительный расчёт перед повторным действием.`);
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }
  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!requestLock.current) props.onClose();
    }
    if (event.key !== 'Tab') return;
    const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'));
    if (!targets.length) return;
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return (
    <div className="billing-invoice-edit-modal" role="dialog" aria-modal="true" aria-labelledby="billing-period-title" onKeyDown={handleKeys}>
      <section className="billing-invoice-edit-modal__panel">
        <header className="billing-invoice-edit-modal__header">
          <h3 id="billing-period-title">Формирование счетов за период</h3>
          <button type="button" className="secondary-button" disabled={busy} onClick={props.onClose}>Закрыть</button>
        </header>
        <div className="billing-invoice-edit-modal__body billing-form" aria-busy={busy}>
          <p>Отдельный счёт для каждого контрагента, филиала и вида услуг. Действует текущая филиальная область доступа. Календарные даты услуг соответствуют датам в существующем биллинге, обе границы включены.</p>
          <fieldset disabled={busy}>
            <legend>Период и услуги</legend>
            <div className="billing-fields">
              <label><span>Контрагент</span>
                <select value={clientId} onChange={event => { invalidate(); setClientId(event.target.value); }}>
                  <option value="">Все доступные контрагенты</option>
                  {props.clients.map(client => <option key={client.id} value={client.id}>{client.code} — {client.name}</option>)}
                </select>
              </label>
              <label><span>Дата услуг с</span><input autoFocus name="periodFrom" type="date" value={periodFrom} onChange={event => { invalidate(); setPeriodFrom(event.target.value); }} /></label>
              <label><span>Дата услуг по</span><input name="periodTo" type="date" value={periodTo} onChange={event => { invalidate(); setPeriodTo(event.target.value); }} /></label>
            </div>
            <div className="billing-period-actions">
              <button className="secondary-button" type="button" onClick={() => preset('week')}>За неделю</button>
              <button className="secondary-button" type="button" onClick={() => preset('fortnight')}>За две недели</button>
              <button className="secondary-button" type="button" onClick={() => preset('month')}>За месяц</button>
            </div>
            <p>Неделя и две недели — от выбранной начальной даты. Месяц — календарный месяц этой даты.</p>
            <div className="billing-period-categories">
              {generationCategories.map(category => (
                <label key={category}><input type="checkbox" checked={categories.includes(category)} onChange={event => {
                  invalidate(); setCategories(current => event.target.checked ? [...current, category] : current.filter(item => item !== category));
                }} /> {categoryLabels[category]}</label>
              ))}
            </div>
            <label><input type="checkbox" checked={excludeLukin} onChange={event => { invalidate(); setExcludeLukin(event.target.checked); }} /> Исключить ИП Лукин</label>
          </fieldset>
          <p>Нулевые счета не создаются. Неподтверждённые начисления, неизвестные тарифы и другие спорные суммы не включаются в итог автоматически.</p>
          <button className="secondary-button" type="button" disabled={busy} onClick={calculate}>Предварительный расчёт</button>
          {busy ? <p role="status">Выполняется запрос. Дождитесь результата, не закрывайте окно.</p> : null}
          {error ? <p role="alert" className="form-error">{error}</p> : null}
          {preview ? <section aria-label="Предварительный расчёт счетов">
            <h4>Расчёт: {preview.periodFrom} — {preview.periodTo}</h4>
            <p>Уже выставлено позиций: {preview.alreadyBilledCount}. Нулевых позиций исключено: {preview.zeroCount}.</p>
            <p>Создать новых: {preview.groups.filter(group => group.action !== 'EXISTING').length}. Существующих за весь период: {preview.groups.filter(group => group.action === 'EXISTING').length}. Итого: {money(preview.groups.reduce((sum, group) => sum + group.totalRub, 0))}. Нерешённые суммы в итог не входят.</p>
            {preview.groups.length ? <div className="billing-table-wrap"><table className="billing-table">
              <thead><tr><th>Контрагент</th><th>Филиал (ID)</th><th>Услуги</th><th>Действие</th><th>Позиций</th><th>Начисления / черновики</th><th>Сумма</th></tr></thead>
              <tbody>{preview.groups.map(group => <tr key={group.key}>
                <td>{group.clientName}</td><td>{group.warehouseId}</td><td>{categoryLabels[group.category]}</td><td>{group.action === 'EXISTING' ? 'Существующий счёт' : 'Создать черновик'}</td><td>{group.itemCount}</td><td>{group.chargeIds.length} / {group.invoiceIds.length}</td><td>{money(group.totalRub)}</td>
              </tr>)}</tbody>
            </table></div> : <p>Нет доступных начислений для создания счетов.</p>}
            {preview.groups.map(group => <details key={`sources:${group.key}`}>
              <summary>Состав: {group.clientName} · {categoryLabels[group.category]} · {group.itemCount} поз.</summary>
              <div className="billing-table-wrap"><table className="billing-table">
                <thead><tr><th>Источник</th><th>Услуга</th><th>Дата услуги</th><th>Количество</th><th>Ед.</th><th>Тариф</th><th>Сумма</th></tr></thead>
                <tbody>{(group.lines ?? []).map((line, index) => <tr key={`${line.sourceId}:${line.invoiceItemId ?? index}`}>
                  <td>{line.sourceType === 'INVOICE' ? `Счёт ${line.sourceNumber ?? line.sourceId}` : `Начисление ${line.sourceId}`}</td>
                  <td>{line.description}</td><td>{line.serviceDate}</td><td>{line.quantity}</td><td>{line.unit}</td><td>{money(Number(line.unitPriceRub))}</td><td>{money(Number(line.totalRub))}</td>
                </tr>)}</tbody>
              </table></div>
            </details>)}
            {preview.issues.length ? <div role="status"><h4>Не включено — требуется проверка</h4><ul>{preview.issues.map((issue, index) => <li key={`${issue.id}-${index}`}>{issue.clientName}: {issue.message}</li>)}</ul></div> : null}
            {preview.groups.length ? <><p>Подтверждение создаст документы с действием «Создать черновик». Подходящие существующие счета будут сохранены. Уже выставленные и оплаченные счета не переписываются. Сервер повторно проверит исходные данные.</p><button className="primary-button" type="button" disabled={busy} onClick={confirm}>Подтвердить создание черновиков</button></> : null}
          </section> : null}
          {created ? <div role="status"><h4>{created.replayed ? 'Результат ранее выполненного формирования' : 'Результат формирования'}</h4><ul>{created.invoices.map(invoice => <li key={invoice.id}>{invoice.number} · {invoice.disposition === 'EXISTING' ? 'Существующий счёт' : 'Создан черновик'}</li>)}</ul><p>Откройте счёт в реестре для проверки и последующих действий.</p></div> : null}
        </div>
      </section>
    </div>
  );
}

function money(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(value);
}
