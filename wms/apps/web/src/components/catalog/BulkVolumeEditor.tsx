import { CheckCheck, Gauge, RefreshCw, Save } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  fetchBulkSkuVolume,
  updateBulkSkuVolume,
  type AuthSession,
  type BulkSkuVolumeData,
  type ClientSummary,
} from '../../lib/api';

type BulkVolumeEditorProps = {
  clients: ClientSummary[];
  defaultClientId: string;
  onApplied: () => void;
  session: AuthSession;
};

const emptyData: BulkSkuVolumeData = {
  client: { id: '', code: '', name: '' },
  volumes: [],
  items: [],
  total: 0,
};

export function BulkVolumeEditor({ clients, defaultClientId, onApplied, session }: BulkVolumeEditorProps) {
  const [clientId, setClientId] = useState(defaultClientId);
  const [sourceVolumeFrom, setSourceVolumeFrom] = useState('');
  const [sourceVolumeTo, setSourceVolumeTo] = useState('');
  const [targetVolume, setTargetVolume] = useState('');
  const [data, setData] = useState<BulkSkuVolumeData>(emptyData);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (defaultClientId) {
      setClientId(defaultClientId);
    } else if (!clientId && clients.length === 1) {
      setClientId(clients[0].id);
    }
  }, [clientId, clients, defaultClientId]);

  useEffect(() => {
    if (!clientId) {
      setData(emptyData);
      setSourceVolumeFrom('');
      setSourceVolumeTo('');
      setSelectedIds(new Set());
      return;
    }
    const rangeFrom = parseVolume(sourceVolumeFrom);
    const rangeTo = parseVolume(sourceVolumeTo);
    const rangeReady = rangeFrom !== null && rangeTo !== null && rangeFrom <= rangeTo;
    let active = true;
    setLoading(true);
    setError('');
    fetchBulkSkuVolume(session.accessToken, {
      clientId,
      sourceVolumeFrom: rangeReady ? rangeFrom : undefined,
      sourceVolumeTo: rangeReady ? rangeTo : undefined,
    })
      .then((result) => {
        if (!active) return;
        setData(result);
        setSelectedIds(new Set(result.items.map((item) => item.id)));
      })
      .catch((caught) => {
        if (!active) return;
        setError(readableError(caught, 'Не удалось загрузить товары по литражу.'));
        setData(emptyData);
        setSelectedIds(new Set());
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId, reloadKey, session.accessToken, sourceVolumeFrom, sourceVolumeTo]);

  const sourceLabel = useMemo(() => {
    const from = parseVolume(sourceVolumeFrom);
    const to = parseVolume(sourceVolumeTo);
    if (from === null || to === null) return '';
    return from === to
      ? `${formatVolume(from)} л`
      : `от ${formatVolume(from)} до ${formatVolume(to)} л`;
  }, [sourceVolumeFrom, sourceVolumeTo]);

  const rangeReady = useMemo(() => {
    const from = parseVolume(sourceVolumeFrom);
    const to = parseVolume(sourceVolumeTo);
    return from !== null && to !== null && from <= to;
  }, [sourceVolumeFrom, sourceVolumeTo]);

  function changeClient(nextClientId: string) {
    setClientId(nextClientId);
    setSourceVolumeFrom('');
    setSourceVolumeTo('');
    setTargetVolume('');
    setMessage('');
    setError('');
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(data.items.map((item) => item.id)) : new Set());
  }

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTarget = Number(targetVolume.replace(',', '.'));
    const normalizedFrom = parseVolume(sourceVolumeFrom);
    const normalizedTo = parseVolume(sourceVolumeTo);
    if (!clientId || normalizedFrom === null || normalizedTo === null || normalizedFrom > normalizedTo
      || selectedIds.size === 0 || !Number.isFinite(normalizedTarget) || normalizedTarget <= 0) {
      setError('Выберите клиента, корректный диапазон, товары и укажите новый литраж больше нуля.');
      return;
    }
    const confirmed = window.confirm(
      `Изменить литраж у ${selectedIds.size} товаров: ${sourceLabel} → ${formatVolume(normalizedTarget)} л?\n\nГабариты карточек останутся без изменений.`,
    );
    if (!confirmed) return;

    setSaving(true);
    setMessage('');
    setError('');
    try {
      const result = await updateBulkSkuVolume(session.accessToken, {
        clientId,
        sourceVolumeFrom: normalizedFrom,
        sourceVolumeTo: normalizedTo,
        skuIds: [...selectedIds],
        newVolumeLiters: normalizedTarget,
      });
      setMessage(`Готово: литраж изменён у ${result.updated} товаров. Габариты карточек не изменялись.`);
      setSourceVolumeFrom(String(result.newVolumeLiters));
      setSourceVolumeTo(String(result.newVolumeLiters));
      setTargetVolume('');
      setReloadKey((current) => current + 1);
      onApplied();
    } catch (caught) {
      setError(readableError(caught, 'Не удалось массово изменить литраж.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="catalog-volume-editor" aria-label="Массовое изменение литража">
      <div className="catalog-volume-editor__heading">
        <div className="catalog-volume-editor__title">
          <span className="catalog-volume-editor__icon"><Gauge size={20} aria-hidden="true" /></span>
          <div>
            <strong>Массовое изменение литража</strong>
            <span>Ручной литраж имеет приоритет над габаритами карточки и используется в расчёте хранения</span>
          </div>
        </div>
        <button className="icon-button" type="button" onClick={() => setReloadKey((current) => current + 1)} title="Обновить данные">
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </div>

      <form className="catalog-volume-editor__form" onSubmit={(event) => void apply(event)}>
        <label>
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => changeClient(event.target.value)} required>
            <option value="">Выберите клиента</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.code} · {client.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Литраж от, л</span>
          <input
            type="number"
            inputMode="decimal"
            min="0.001"
            max="1000000"
            step="0.001"
            value={sourceVolumeFrom}
            onChange={(event) => {
              setSourceVolumeFrom(event.target.value);
              setMessage('');
              setError('');
            }}
            disabled={!clientId}
            placeholder="От"
            required
          />
        </label>
        <label>
          <span>Литраж до, л</span>
          <input
            type="number"
            inputMode="decimal"
            min="0.001"
            max="1000000"
            step="0.001"
            value={sourceVolumeTo}
            onChange={(event) => {
              setSourceVolumeTo(event.target.value);
              setMessage('');
              setError('');
            }}
            disabled={!clientId}
            placeholder="До"
            required
          />
        </label>
        <label>
          <span>Новый литраж, л</span>
          <input
            type="number"
            inputMode="decimal"
            min="0.001"
            max="1000000"
            step="0.001"
            value={targetVolume}
            onChange={(event) => setTargetVolume(event.target.value)}
            placeholder="Например, 3.5"
            required
          />
        </label>
        <button className="primary-button" type="submit" disabled={saving || loading || selectedIds.size === 0}>
          <Save size={16} aria-hidden="true" />
          <span>{saving ? 'Изменяю…' : `Изменить у ${selectedIds.size}`}</span>
        </button>
      </form>

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      {rangeReady ? (
        <div className="catalog-volume-editor__results">
          <div className="catalog-volume-editor__summary">
            <span><CheckCheck size={16} aria-hidden="true" /> Найдено: {data.total} · выбрано: {selectedIds.size}</span>
            <button className="text-button" type="button" onClick={() => toggleAll(selectedIds.size !== data.items.length)}>
              {selectedIds.size === data.items.length && data.items.length > 0 ? 'Снять выбор' : 'Выбрать все'}
            </button>
          </div>
          <div className="catalog-volume-editor__table-wrap">
            <table className="catalog-volume-editor__table">
              <thead>
                <tr>
                  <th>
                    <input
                      aria-label="Выбрать все товары"
                      type="checkbox"
                      checked={data.items.length > 0 && selectedIds.size === data.items.length}
                      onChange={(event) => toggleAll(event.target.checked)}
                    />
                  </th>
                  <th>Товар</th>
                  <th>Артикул / ШК</th>
                  <th>Габариты</th>
                  <th>Текущий литраж</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <input
                        aria-label={`Выбрать ${item.name}`}
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={(event) => toggleOne(item.id, event.target.checked)}
                      />
                    </td>
                    <td><strong>{item.name}</strong><span>{item.internalSku}</span></td>
                    <td><strong>{item.article || item.clientSku || '—'}</strong><span>{item.barcodes.find((barcode) => barcode.isPrimary)?.value || item.barcodes[0]?.value || '—'}</span></td>
                    <td>{formatDimensions(item)}</td>
                    <td><strong>{item.volumeLiters == null ? 'Не задан' : `${formatVolume(item.volumeLiters)} л`}</strong><span>{item.volumeSource === 'MANUAL' ? 'ручной' : 'по габаритам'}</span></td>
                  </tr>
                ))}
                {data.items.length === 0 ? (
                  <tr><td colSpan={5}>{loading ? 'Загрузка товаров…' : 'Товаров в выбранном диапазоне нет'}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatVolume(value: string | number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(number)
    : String(value);
}

function parseVolume(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatDimensions(item: { lengthCm: string | number | null; widthCm: string | number | null; heightCm: string | number | null }) {
  const dimensions = [item.lengthCm, item.widthCm, item.heightCm].map((value) => Number(value));
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) return 'Не указаны';
  return `${dimensions.map((value) => formatVolume(value)).join(' × ')} см`;
}

function readableError(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}
