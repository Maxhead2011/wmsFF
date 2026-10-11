import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createManualFbsAssembly, fetchManualFbsCapabilities, fetchManualFbsOptions, previewManualFbsAssembly, type AuthSession } from '../../lib/api';
import { defaultManualFbsChoices, manualFbsChoicesReady, parseManualFbsOrders,
  type ManualFbsChoice, type ManualFbsOptions, type ManualFbsPreview, type ManualFbsResult } from '../../lib/fbs-manual-assembly';

export function FbsManualAssemblyResults({ preview, choices, disabled, onChoose }: {
  preview: ManualFbsPreview; choices: ManualFbsChoice[]; disabled: boolean; onChoose: (orderId: string, boxId: string) => void;
}) {
  return <div style={{ overflowX: 'auto' }}><table className="data-table" aria-label="Проверка заказов и мест отбора">
    <thead><tr><th>Заказ / поставка WB</th><th>Товар</th><th>Свободно</th><th>Место отбора</th></tr></thead>
    <tbody>{preview.rows.map(row => <tr key={row.orderId}>
      <td><strong>{row.orderId}</strong><br/>{row.supplyId || 'Поставка не найдена'}<br/>{row.supplierStatus || 'Нет статуса'} / {row.wbStatus || 'Нет статуса'}</td>
      <td>{row.article || 'Товар не найден'}<br/>{row.size}<br/>К сборке: 1 шт.</td>
      <td>{row.free} шт.</td>
      <td>{row.blockers.length ? row.blockers.map(reason => <p role="alert" key={reason}>{reason}</p>) :
        <select aria-label={`Короб для заказа ${row.orderId}`} disabled={disabled} value={choices.find(c => c.orderId === row.orderId)?.boxId || ''}
          onChange={e => onChoose(row.orderId, e.target.value)}>
          <option value="">Выберите короб</option>
          {row.boxes.map(b => <option key={b.boxId} value={b.boxId}>{b.boxCode} · {b.palletCode} · свободно {b.free} шт.</option>)}
        </select>}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function FbsManualAssemblyPanel({ session, clientId }: { session: AuthSession; clientId: string }) {
  const [options, setOptions] = useState<ManualFbsOptions | null>(null), [enabled, setEnabled] = useState(false);
  const [connectionId, setConnectionId] = useState(''), [warehouseId, setWarehouseId] = useState('');
  const [text, setText] = useState(''), [preview, setPreview] = useState<ManualFbsPreview | null>(null);
  const [choices, setChoices] = useState<ManualFbsChoice[]>([]), [result, setResult] = useState<ManualFbsResult | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const generation = useRef(0), creating = useRef<number | null>(null);
  useEffect(() => {
    // FIX: a branch/account change invalidates pending UI work without leaving the form busy.
    const ticket = ++generation.current; creating.current = null; setBusy(false); setLoading(true); setError(''); setOptions(null); setPreview(null); setResult(null); setEnabled(false);
    if (!clientId) { setLoading(false); return; }
    void (async () => {
      try {
        const capability = await fetchManualFbsCapabilities(session.accessToken);
        if (ticket !== generation.current) return;
        setEnabled(capability.enabled);
        if (!capability.enabled) return;
        const data = await fetchManualFbsOptions(session.accessToken, clientId);
        if (ticket !== generation.current) return;
        setOptions(data); setConnectionId(data.connections.length === 1 ? data.connections[0].id : '');
        setWarehouseId(data.warehouses.some(w => w.id === session.user.activeWarehouseId) ? session.user.activeWarehouseId! : '');
      } catch (e) { if (ticket === generation.current) setError(e instanceof Error ? e.message : 'Не удалось загрузить параметры.'); }
      finally { if (ticket === generation.current) setLoading(false); }
    })();
    return () => { generation.current++; };
  }, [clientId, session.accessToken, session.user.activeWarehouseId]);
  function reset() { generation.current++; setPreview(null); setChoices([]); setResult(null); setError(''); }
  async function check(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    let orderIds: string[];
    try { orderIds = parseManualFbsOrders(text); } catch (e) { setError((e as Error).message); return; }
    const ticket = ++generation.current; setBusy(true); setError(''); setResult(null); setPreview(null);
    try {
      const data = await previewManualFbsAssembly(session.accessToken, { clientId, connectionId, warehouseId, orderIds });
      if (ticket === generation.current) { setPreview(data); setChoices(defaultManualFbsChoices(data.rows)); }
    } catch (e) { if (ticket === generation.current) setError(e instanceof Error ? e.message : 'Не удалось проверить заказы.'); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  async function create() {
    if (creating.current !== null || !preview?.token || !manualFbsChoicesReady(preview, choices)) return;
    const ticket = generation.current; creating.current = ticket; setBusy(true); setError('');
    try {
      const data = await createManualFbsAssembly(session.accessToken, preview.token, choices);
      if (ticket === generation.current) setResult(data);
    } catch (e) {
      if (ticket === generation.current) setError((e instanceof Error ? e.message : 'Ответ не получен.') + ' Можно повторить создание: сохранённая заявка не продублируется.');
    } finally { if (creating.current === ticket) creating.current = null; if (ticket === generation.current) setBusy(false); }
  }
  if (!clientId) return <p>Выберите клиента для сборки ФБС.</p>;
  return <section className="service-section" aria-label="Сборка ФБС по номерам заказов">
    <h3>Сборка ФБС по номерам заказов</h3>
    <p>Активные заказы WB за последние 30 дней. Одна заявка в выбранном филиале, по одной единице на заказ. Исходные поставки WB сохраняются.</p>
    {loading && <p role="status">Загружаю параметры…</p>}
    {!loading && !enabled && !error && <p>Функция не включена или недоступна вашей роли.</p>}
    {error && <p role="alert">{error}</p>}
    {enabled && options && <form className="service-form-card" onSubmit={check}>
      <label><span>Кабинет WB</span><select required disabled={busy} value={connectionId} onChange={e => { reset(); setConnectionId(e.target.value); }}>
        <option value="">Выберите кабинет</option>{options.connections.map(c => <option key={c.id} value={c.id}>{c.accountName || c.sellerId || `WB · ${c.id.slice(0, 8)}`}</option>)}
      </select></label>
      <label><span>Филиал сборки</span><select required disabled={busy} value={warehouseId} onChange={e => { reset(); setWarehouseId(e.target.value); }}>
        <option value="">Выберите филиал</option>{options.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select></label>
      <label><span>Номера заказов</span><textarea required rows={5} disabled={busy} value={text} placeholder={'5996192771\n5996851459'} onChange={e => { reset(); setText(e.target.value); }}/></label>
      <button className="secondary-button" type="submit" disabled={busy || !connectionId || !warehouseId}>{busy ? 'Проверяю…' : 'Проверить заказы и остатки'}</button>
    </form>}
    {preview && <>
      <FbsManualAssemblyResults preview={preview} choices={choices} disabled={busy || !!result} onChoose={(orderId, boxId) => setChoices(rows => rows.map(r => r.orderId === orderId ? { ...r, boxId } : r))}/>
      {!result && <><p>Проверьте места отбора. Заявка создаст резерв на {preview.rows.length} шт.; фактический отбор выполняется на ТСД.</p>
        <button type="button" className="primary-button" disabled={busy || !manualFbsChoicesReady(preview, choices)} onClick={() => void create()}>{busy ? 'Выполняю…' : 'Создать заявку ФБС'}</button></>}
    </>}
    {result && <p role="status"><strong>Заявка №{result.request.number} {result.alreadyCreated ? 'уже создана' : 'создана'}.</strong> Статус «В работе». Откройте сборку ФБС на ТСД.</p>}
  </section>;
}
