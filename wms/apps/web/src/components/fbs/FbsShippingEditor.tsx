import { useState } from 'react';
import { configureFbsShipping, type FbsOrderSelectionPayload, type WbShippingPoint } from '../../lib/api';

// FIX: a per-supply shipping point editor, separate from the destination warehouse.
export function FbsShippingEditor({ accessToken, payload, supplyId, pointId, cargoIds, disabled }: {
  accessToken: string; payload: FbsOrderSelectionPayload; supplyId: string;
  pointId?: string | null; cargoIds?: string[]; disabled: boolean;
}) {
  const [city, setCity] = useState('Москва');
  const [points, setPoints] = useState<WbShippingPoint[] | null>(null);
  const [selected, setSelected] = useState(pointId ?? '');
  const [search, setSearch] = useState('');
  const [ids, setIds] = useState(cargoIds ?? []);
  const [total, setTotal] = useState(String(Math.max(1, cargoIds?.length ?? 0)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const chosen = points?.find((point) => point.id === selected);
  const matching = points?.filter((point) => `${point.name} ${point.address} ${point.id}`.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))) ?? [];
  const visible = matching.slice(0, 200);
  if (chosen && !visible.some((point) => point.id === chosen.id)) visible.unshift(chosen);
  async function perform(mode: 'points' | 'save' | 'cargo') {
    if (busy || disabled) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await configureFbsShipping(accessToken, mode, { ...payload, shippingCity: city,
        shippingPointId: selected, ...(mode === 'cargo' ? { cargoPlaceTotal: Number(total) } : {}) });
      if (mode === 'points') { setPoints(result.points ?? []); setSaved(false); }
      if (mode === 'save') { setSaved(true); setMessage('Пункт сдачи и дата сохранены в WB.'); }
      if (result.cargoPlaceIds) { setIds(result.cargoPlaceIds); setTotal(String(result.cargoPlaceIds.length)); setMessage('Грузоместа подтверждены WB. Распределите заказы и закройте грузоместа на ТСД; стикеры доступны в документах поставки.'); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось обновить поставку.'); }
    finally { setBusy(false); }
  }
  return <fieldset className="wb-shipping-editor" disabled={busy || disabled} style={{ border: '1px solid var(--border-color, #dbe3eb)', borderRadius: 12, padding: 12, marginTop: 12 }}>
    <legend>Пункт сдачи · {supplyId}</legend>
    {pointId ? <p>В WB выбран пункт №{pointId}. Для изменения или подтверждения загрузите доступные пункты.</p> : null}
    <label>Населённый пункт <input value={city} maxLength={120} onChange={(event) => { setCity(event.target.value); setPoints(null); setSaved(false); }} /></label>
    <button type="button" className="button button-secondary" onClick={() => void perform('points')}>{busy ? 'Проверяю…' : 'Найти пункты сдачи'}</button>
    {points ? <>
      <label>Поиск по адресу или номеру ПВЗ <input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label>ПВЗ / пункт приёма <select value={selected} onChange={(event) => { setSelected(event.target.value); setSaved(false); }}>
        <option value="">Выберите пункт</option>
        {visible.map((point) => <option key={point.id} value={point.id} disabled={!point.available}>{point.name} · {point.address}{point.available ? '' : ' · недоступен'}</option>)}
      </select></label>
      {!points.length ? <p>На выбранную дату в этом населённом пункте нет доступных пунктов сдачи.</p> : null}
      {matching.length > 200 ? <small>Найдено {matching.length} пунктов. Уточните адрес — в списке показаны первые 200.</small> : null}
      <p>Доставка до пункта — своими силами. Склад назначения товара остаётся прежним.</p>
      <button type="button" className="button button-primary" disabled={!chosen?.available} onClick={() => void perform('save')}>Сохранить пункт и дату в WB</button>
    </> : null}
    <p>Грузомест в WB: {ids.length}{ids.length ? ` · ${ids.join(', ')}` : ''}</p>
    {saved && chosen && ['pp', 'pfc', 'gpp'].includes(chosen.officeType) ? <>
      <label>Итоговое количество грузомест <input type="number" min={Math.max(1, ids.length)} max={1000} value={total} onChange={(event) => setTotal(event.target.value)} /></label>
      <button type="button" className="button button-secondary" disabled={!Number.isInteger(Number(total)) || Number(total) < Math.max(1, ids.length)} onClick={() => void perform('cargo')}>Добавить недостающие грузоместа</button>
    </> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert" className="fbs-assembly-dialog__warning">{error}</p> : null}
  </fieldset>;
}
