import { useEffect, useRef, useState } from 'react';
import { createFbsRepeatAssembly, fetchFbsRepeatCapabilities, previewFbsRepeatAssembly,
  type AuthSession, type FbsRepeatPreview, type FbsRepeatSelection } from '../../lib/api';

// FIX: the deliberate repeat is separate from resetting or moving unfinished orders.
export function FbsRepeatAssemblyPanel({ session, selection, onOpenRequest }: {
  session: AuthSession; selection: FbsRepeatSelection;
  onOpenRequest?: (requestId: string) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [preview, setPreview] = useState<FbsRepeatPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ id: string; number: number } | null>(null);
  const revision = JSON.stringify([session.user.activeWarehouseId, selection.clientId, selection.orders]);
  const currentRevision = useRef(revision);
  currentRevision.current = revision;
  useEffect(() => {
    let alive = true;
    fetchFbsRepeatCapabilities(session.accessToken).then(result => { if (alive) setEnabled(result.enabled); })
      .catch(() => { if (alive) setEnabled(false); });
    return () => { alive = false; };
  }, [session.accessToken]);
  useEffect(() => { setPreview(null); setConfirmed(false); setError(''); setCreated(null); }, [revision]);

  async function check() {
    setBusy(true); setError(''); setPreview(null); setConfirmed(false); setCreated(null);
    try {
      const result = await previewFbsRepeatAssembly(session.accessToken, selection);
      if (currentRevision.current === revision) setPreview(result);
    } catch (error) {
      if (currentRevision.current === revision) setError(error instanceof Error ? error.message : 'Не удалось проверить заказы.');
    } finally { setBusy(false); }
  }
  async function create() {
    if (!preview || !confirmed || busy) return;
    setBusy(true); setError('');
    try {
      const result = await createFbsRepeatAssembly(session.accessToken, { clientId: selection.clientId,
        orders: preview.orders.map(({ id, connectionId, assemblyId }) => ({ id, connectionId, assemblyId })),
        previewToken: preview.previewToken, confirmAdditionalStockConsumption: true });
      if (currentRevision.current === revision) { setCreated(result.request); setPreview(null); setConfirmed(false); }
    } catch (error) {
      if (currentRevision.current === revision) setError(error instanceof Error ? error.message : 'Заявка не создана.');
    } finally { setBusy(false); }
  }

  if (!enabled) return null;
  return <section className="fbs-delivery-recovery" aria-label="Отдельная повторная сборка">
    <h4>Повторная физическая сборка</h4>
    <p>Отметьте нужные отгруженные заказы. Сначала проверим WB и свободные остатки. Прежняя сборка останется в истории.</p>
    <button className="button-secondary" type="button" disabled={busy || !selection.orders.length || selection.orders.length > 100}
      onClick={() => void check()}>{busy ? 'Проверяем…' : `Проверить для повторной сборки · ${selection.orders.length}`}</button>
    {error && <p role="alert" className="form-error">{error}</p>}
    {preview && <div aria-live="polite">
      <p><strong>Заказов: {preview.orderCount}. Дополнительный расход: {preview.additionalUnits} ед.</strong></p>
      <p>{preview.warning}</p>
      <div style={{ overflow: 'auto', maxHeight: 320 }} tabIndex={0} role="region" aria-label="Проверенные заказы и места хранения">
        <table><thead><tr><th>Заказ WB</th><th>Из заявки</th><th>Поставка</th><th>Товар</th><th>Короб / паллет-сорт</th></tr></thead>
          <tbody>{preview.orders.map(order => <tr key={order.assemblyId}><td>{order.id}</td><td>№{order.sourceRequestNumber}</td>
            <td>{order.sourceSupplyId}</td><td>{order.productName}<br />{order.article}</td>
            <td>{order.boxCode}<br />{order.palletCode ?? 'Без паллет-сорта'}</td></tr>)}</tbody></table>
      </div>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
        Подтверждаю отдельную повторную сборку и дополнительное списание остатков</label>
      <button type="button" className="button-primary" disabled={!confirmed || busy} onClick={() => void create()}>
        {busy ? 'Создаём…' : 'Создать отдельную повторную заявку'}</button>
    </div>}
    {created && <p role="status">Создана заявка №{String(created.number).padStart(6, '0')}. Прежняя история сохранена.
      {onOpenRequest && <button type="button" className="button-secondary" onClick={() => onOpenRequest(created.id)}>Открыть заявку</button>}</p>}
  </section>;
}
