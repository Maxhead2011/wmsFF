import { useState } from 'react';
import { createSizeSubstitution, previewSizeSubstitution, type AuthSession, type SizeSubstitutionPreview } from '../../lib/api';

// FIX: selection is local to one client/order/preview and always requires explicit relabel approval.
export function SizeSubstitutionPanel({ session, clientId }: { session: AuthSession; clientId: string }) {
  const [orderId, setOrderId] = useState('');
  const [preview, setPreview] = useState<SizeSubstitutionPreview | null>(null);
  const [selected, setSelected] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [created, setCreated] = useState<{ number: number } | null>(null);
  async function search() {
    setBusy(true); setMessage(''); setPreview(null); setSelected(''); setConfirmed(false); setCreated(null);
    try { setPreview(await previewSizeSubstitution(session.accessToken, { clientId, orderId: orderId.trim() })); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось проверить заказ.'); }
    finally { setBusy(false); }
  }
  async function create() {
    if (!preview?.taskId || !preview.previewToken || !selected || !confirmed) return;
    setBusy(true); setMessage('');
    try { setCreated(await createSizeSubstitution(session.accessToken, { clientId, orderId: orderId.trim(),
      taskId: preview.taskId, sourceSkuId: selected, previewToken: preview.previewToken, confirmRelabel: true })); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Заявка не создана.'); }
    finally { setBusy(false); }
  }
  return <section className="service-card">
    <h2>Замена размера WB</h2>
    <p>Сначала соседние размеры того же товара и цвета; если их нет — более отдалённые. Выберите замену для сборки с переклейкой.</p>
    <form onSubmit={e => { e.preventDefault(); void search(); }}>
      <label>Номер заказа WB <input inputMode="numeric" value={orderId} disabled={busy} onChange={e => {
        setOrderId(e.target.value); setPreview(null); setSelected(''); setConfirmed(false); setCreated(null);
      }} /></label>{' '}
      <button type="submit" disabled={busy || !clientId || !/^\d+$/.test(orderId.trim())}>Предложить замены</button>
    </form>
    {message && <p role="alert">{message}</p>}
    {(created || preview?.existingRequest) && <p role="status">Заявка №{String((created || preview!.existingRequest)!.number).padStart(6, '0')} создана. Откройте её в сборке FBS WB.</p>}
    {preview?.target && !created && <>
      {preview.warning && <p role="note">{preview.warning}</p>}
      <h3>Заказано: {preview.target.article || preview.target.name} · {preview.target.color} · {preview.target.size}</h3>
      <p>Целевой баркод: {preview.target.barcodes.join(', ')}</p>
      {!preview.options.length && <p>Свободных замен нет. Остатки и заказ не изменены.</p>}
      {preview.options.map(option => <label key={option.id} style={{ display: 'block', padding: 12, borderBottom: '1px solid #ddd' }}>
        <input type="checkbox" checked={selected === option.id} disabled={busy} onChange={() => { setSelected(selected === option.id ? '' : option.id); setConfirmed(false); }} />{' '}
        <strong>{option.article || option.name} · {option.size}</strong> · {option.color} · свободно {option.available} шт.
        <div>Отобрать ШК {option.barcodes.join(', ')} → переклеить на {preview.target!.barcodes.join(', ')} ({preview.target!.size})</div>
        <div>{option.distance === 1 ? 'Соседний размер' : 'Отдалённый размер — соседних нет'}</div>
        <div>{option.boxes.map(box => `${box.code} / ${box.pallet}: ${box.available} шт.`).join('; ')}</div>
      </label>)}
      {selected && <>
        <p><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> Подтверждаю замену размера и переклейку на товар из заказа.</label></p>
        <p>Исходный товар спишется при фактическом отборе. КИЗ проходит штатную проверку при сборке.</p>
        <button disabled={busy || !confirmed} onClick={() => void create()}>Создать заявку на сборку</button>
      </>}
    </>}
  </section>;
}
