import { isValidLowStockReserve, WbLowStockReserveFields, WbLowStockReserveSummary } from '../fbs/WbLowStockReserveFields';
import { wbReservePreviewAmount } from '../../lib/wbStockPreview';
import { useEffect, useMemo, useRef, useState } from 'react';
import { updateWbStockReserve, type WbStockReserve, fetchMarketplaceStockControl, updateMarketplaceStockControl, type AuthSession, type MarketplaceStockControlRow } from '../../lib/api';

export function canManageMarketplaceStockControl(session: AuthSession) {
  return !session.user.isDemo && !session.user.roleCodes.includes('CLIENT') && session.user.permissionCodes.includes('system:admin');
}

export function AdministrationMarketplaceStockControl({ session }: { session: AuthSession }) {
  const [rows, setRows] = useState<MarketplaceStockControlRow[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<MarketplaceStockControlRow | null>(null);
  const inFlight = useRef(false);
  const allowed = canManageMarketplaceStockControl(session);
  const visible = useMemo(() => rows.filter((row) => `${row.code} ${row.name}`.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))), [rows, search]);

  async function load() {
    if (!allowed || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try { setRows(await fetchMarketplaceStockControl(session.accessToken)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить настройки.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  useEffect(() => { void load(); }, [session.accessToken, allowed]);

  async function toggle(row: MarketplaceStockControlRow) {
    if (inFlight.current) return;
    const enabled = !row.enabled;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const updated = await updateMarketplaceStockControl(session.accessToken, row, enabled);
      // FIX: display only the server-confirmed state; failed saves never flip the switch.
      setRows((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      setMessage(`${updated.code} — ${updated.name}: ${updated.enabled ? 'контроль WMS включён' : 'контроль WMS выключен, остатками управляет отдел продаж'}. Изменение записано в журнал.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить настройку.');
    } finally { inFlight.current = false; setBusy(false); setSelected(null); }
  }

  if (!allowed) return null;
  return <section className="admin-card" aria-busy={busy}>
    <h2>Контроль остатков на МП</h2>
    <p>Включён — WMS отправляет остатки по существующим правилам. Выключен — остатками на маркетплейсе управляет отдел продаж клиента, автоматическая и ручная отправка из WMS запрещена.</p>
    <p>Настройка действует во всех филиалах и кабинетах клиента. Загрузка заказов, приёмка, сборка и складской учёт продолжают работать. Отключение не обнуляет остатки на маркетплейсе.</p>
    <p>Сейчас отправка остатков реализована для Wildberries. Уже отправленный запрос может завершиться после отключения.</p>
    <div className="admin-stock-check__toolbar">
      <label>Найти клиента <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Код или имя клиента" /></label>
      <span>Показано: {visible.length} из {rows.length}</span>
      <button type="button" className="admin-button admin-button--compact" disabled={busy || !!selected} onClick={() => void load()}>{busy ? 'Загрузка…' : 'Обновить'}</button>
    </div>
    {error && <div className="admin-message admin-message--error" role="alert">{error}</div>}
    {message && <div className="admin-message admin-message--ok" role="status">{message}</div>}
    {selected && <div className="admin-card" role="alertdialog" aria-labelledby="mp-control-confirm-title">
      <h3 id="mp-control-confirm-title">{selected.enabled ? 'Выключить' : 'Включить'} контроль WMS: {selected.code} — {selected.name}?</h3>
      <p>{selected.enabled ? 'Остатками на МП будет управлять отдел продаж. Новые отправки из WMS будут запрещены.' : 'WMS снова сможет отправлять рассчитанные остатки на МП при следующей синхронизации по существующим настройкам.'} Настройка действует во всех филиалах и кабинетах клиента.</p>
      <button type="button" className="admin-button admin-button--primary" disabled={busy} onClick={() => void toggle(selected)}>{busy ? 'Сохранение…' : 'Подтвердить'}</button>{' '}
      <button type="button" className="admin-button admin-button--compact" disabled={busy} onClick={() => setSelected(null)}>Отмена</button>
    </div>}
    <div className="admin-stock-check__table-wrap" style={{ maxHeight: '60vh', overflow: 'auto' }} tabIndex={0} aria-label="Настройки клиентов">
      <table className="admin-stock-check__table">
        <thead style={{ position: 'sticky', top: 0 }}><tr><th>Клиент</th><th>Кто управляет остатками МП</th><th>Контроль через WMS</th><th>Последнее изменение</th></tr></thead>
        <tbody>{visible.map((row) => <tr key={row.id}>
          <td><strong>{row.name}</strong><small>{row.code}</small>{row.fineSettingsEnabled && <WbReserveEditor key={`${row.id}:${row.reserveUpdatedAt}`} row={row} session={session} onSaved={() => void load()} />}</td>
          <td>{row.enabled ? 'WMS' : 'Отдел продаж клиента'}</td>
          <td><button type="button" role="switch" aria-checked={row.enabled} aria-label={`Контроль WMS: ${row.code} — ${row.name}`} className={row.enabled ? 'admin-button admin-button--primary' : 'admin-button admin-button--compact'} disabled={busy || !!selected} onClick={() => setSelected(row)}>{row.enabled ? 'Включён · выключить' : 'Выключен · включить'}</button></td>
          <td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString('ru-RU') : 'По умолчанию'}<small>{row.updatedBy}</small></td>
        </tr>)}</tbody>
      </table>
      {!busy && visible.length === 0 && <p>Клиенты не найдены.</p>}
    </div>
  </section>;
}

function WbReserveEditor({ row, session, onSaved }: { row: MarketplaceStockControlRow; session: AuthSession; onSaved: () => void }) {
  const [rule, setRule] = useState<WbStockReserve>(row.reserve ?? { mode: 'NONE', value: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sample, setSample] = useState(10);
  async function save() {
    setBusy(true); setError('');
    try { await updateWbStockReserve(session.accessToken, row.id, rule, row.reserveUpdatedAt ?? null); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить резерв.'); }
    finally { setBusy(false); }
  }
  return <details><summary>Резерв WB: {row.reserve?.mode === 'UNITS' ? `${row.reserve.value} шт.` : row.reserve?.mode === 'PERCENT' ? `${row.reserve.value}%` : 'без резерва'}</summary>
    <p>Оставлять резерв каждой позиции перед распределением по складам WB. Фактические остатки ВМС не меняются.</p>
    <label>Режим <select disabled={busy} value={rule.mode} onChange={e => setRule({ ...rule, mode: e.target.value as WbStockReserve['mode'], value: 0 })}>
      <option value="NONE">Весь доступный остаток</option><option value="UNITS">Резерв в штуках</option><option value="PERCENT">Резерв в процентах</option>
    </select></label>
    {rule.mode !== 'NONE' && <label>Величина <input type="number" min={0} max={rule.mode === 'PERCENT' ? 100 : 1000000} step={1} value={rule.value} disabled={busy} onChange={e => setRule({ ...rule, value: Number(e.target.value) })} /></label>}
    <WbLowStockReserveSummary rule={row.reserve?.lowStock} />
    <WbLowStockReserveFields value={rule.lowStock} onChange={lowStock => setRule({ ...rule, lowStock })} disabled={busy} />
    <label>Пример: доступно <input type="number" min={0} step={1} value={sample} onChange={e => setSample(Math.max(0, Math.trunc(Number(e.target.value))))} /></label>
    <p>На WB: {wbReservePreviewAmount(sample, rule)} шт. Процентный резерв округляется вверх.</p>
    <button type="button" disabled={busy || !isValidLowStockReserve(rule.lowStock) || !Number.isSafeInteger(rule.value) || rule.value < 0 || rule.value > (rule.mode === 'PERCENT' ? 100 : 1000000)} onClick={() => void save()}>Сохранить резерв</button>
    <p>Сохранение не включает выгрузку. Правило применяется при следующей отправке WB; доли складов — в FBS → Распределение остатков.</p>
    {error && <p role="alert">{error}</p>}
  </details>;
}
