import { useState } from 'react';
import { checkFbsStockPublication, updateWbAnalysisSettings, updateWbSkuRule, type AuthSession, type FbsStockAllocationResponse, type WbStockReserve } from '../../lib/api';

type Row = NonNullable<FbsStockAllocationResponse['analysis']>['rows'][number];
type Context = { session: AuthSession; clientId: string; onSaved: () => Promise<void> };
// FIX: an explicit per-SKU rule overrides the client reserve, not physical warehouse stock.
export function WbSkuRuleEditor({ session, clientId, onSaved, row }: Context & { row: Row }) {
  const [mode, setMode] = useState<WbStockReserve['mode'] | 'INHERIT'>(row.reserveOverride?.mode ?? 'INHERIT');
  const [value, setValue] = useState(row.reserveOverride?.value ?? 0);
  const [blocked, setBlocked] = useState(row.blocked ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try {
      await updateWbSkuRule(session.accessToken, clientId, row.skuId, { reserve: mode === 'INHERIT' ? null : { mode, value: mode === 'NONE' ? 0 : value }, blocked, expectedUpdatedAt: row.ruleUpdatedAt ?? null });
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить исключение.'); }
    finally { setBusy(false); }
  }
  return <details className="fbs-allocation__sku-rule"><summary>{row.reserveOverride ? 'Особый резерв' : 'Исключение для товара'}</summary>
    <label>Резерв товара<select aria-label="Резерв товара" value={mode} onChange={e => setMode(e.target.value as typeof mode)} disabled={busy}>
      <option value="INHERIT">Как у клиента</option><option value="NONE">Без резерва</option><option value="UNITS">В штуках</option><option value="PERCENT">В процентах</option>
    </select></label>
    {(mode === 'UNITS' || mode === 'PERCENT') && <label>Величина резерва<input type="number" min={0} max={mode === 'PERCENT' ? 100 : 1000000} value={value} onChange={e => setValue(Number(e.target.value))} disabled={busy} /></label>}
    <label><input type="checkbox" checked={blocked} onChange={e => setBlocked(e.target.checked)} disabled={busy} />Запретить публикацию товара</label>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void save()}>Сохранить исключение</button>
    {error && <p role="alert">{error}</p>}
  </details>;
}

export function WbAnalysisSettings({ session, clientId, onSaved, settings }: Context & { settings: NonNullable<FbsStockAllocationResponse['analysisSettings']> }) {
  const [step, setStep] = useState(settings.maxShareChange);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { await updateWbAnalysisSettings(session.accessToken, clientId, step, settings.updatedAt); await onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить шаг.'); }
    finally { setBusy(false); }
  }
  return <div><label>Максимальное изменение доли за одно применение, п.п.<input type="number" min={0} max={100} value={step} onChange={e => setStep(Number(e.target.value))} disabled={busy} /></label>
    <p>Например, при шаге 10 доля 20% может стать от 10% до 30%. Ноль — сохранить текущие доли. Рекомендации применяются вручную.</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void save()}>Сохранить шаг рекомендации</button>{error && <p role="alert">{error}</p>}
  </div>;
}

const statusNames: Record<string, string> = { PLANNED: 'Рассчитано', SENDING: 'Отправляется', SENT: 'Отправлено, ждём проверки', CONFIRMED: 'Подтверждено WB', MISMATCH: 'Расхождение', UNCONFIRMED: 'Не подтверждено' };
const date = (s: string | null) => s ? new Date(s).toLocaleString('ru-RU') : '—';
export function WbPublicationChecks({ session, clientId, onSaved, connectionId, data }: Context & { connectionId: string; data: FbsStockAllocationResponse }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function check() {
    setBusy(true); setMessage('');
    try { const result = await checkFbsStockPublication(session.accessToken, clientId, connectionId); await onSaved(); setMessage(`Проверено: ${result.checked}. Расхождений: ${result.mismatches}.`); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Проверка не удалась.'); }
    finally { setBusy(false); }
  }
  return <section className="fbs-allocation__fine"><h4>Подтверждение остатков WB</h4>
    <p>Последний расчёт отправки, отправленная величина и фактический ответ WB. Показаны последние 500 позиций по складам. Предпросмотр выше может отличаться после изменения настроек или остатков WMS.</p>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void check()}>{busy ? 'Проверяю…' : 'Проверить WB сейчас'}</button>
    <p>Проверка не отправляет новые остатки и доступна при выключенном автоуправлении.</p>{message && <p role="status">{message}</p>}
    <div className="fbs-allocation__table-wrap"><table className="fbs-allocation__table"><thead><tr><th>Товар / склад</th><th>Рассчитано</th><th>Отправлено</th><th>На WB</th><th>Статус / время</th></tr></thead><tbody>
      {(data.publicationChecks ?? []).map(row => { const sku = data.analysis?.rows.find(s => s.skuId === row.skuId); return <tr key={row.id}>
        <td>{sku ? `${sku.name} · ${sku.barcode}` : `ID размера WB: ${row.chrtId}`}<br />{data.shares.find(s => s.warehouseId === row.warehouseId)?.warehouseName ?? row.warehouseId}</td>
        <td>{row.calculatedAmount}</td><td>{row.sentAmount ?? '—'}</td><td>{row.observedAmount ?? '—'}</td>
        <td><strong className={`fbs-allocation__proof ${row.status === 'CONFIRMED' ? 'is-confirmed' : 'is-pending'}`}>{statusNames[row.status] ?? row.status}</strong><br />Отправка: {date(row.sentAt)}<br />Проверка: {date(row.checkedAt)}{row.error && <p role="alert">{row.error}</p>}</td>
      </tr>; })}
    </tbody></table></div>{!data.publicationChecks?.length && <p>Подтверждённых отправок в новом режиме ещё нет.</p>}
  </section>;
}
