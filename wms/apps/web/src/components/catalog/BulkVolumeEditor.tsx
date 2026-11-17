import { CheckCheck, Gauge, RefreshCw, Save } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  fetchBulkSkuVolume,
  updateBulkSkuVolume,
  type AuthSession,
  type BulkSkuVolumeData,
  type ClientSummary,
} from '../../lib/api';
import { useRememberedClientId } from '../../lib/rememberedClient';

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
  // FIX: enable product selection only in the own-WMS build.
  const searchEnabled = import.meta.env.VITE_BULK_VOLUME_SEARCH_ENABLED === 'true';
  const [clientId, setClientId] = useRememberedClientId(session.user.id, {
    initialClientId: defaultClientId,
  });
  const [sourceVolumeFrom, setSourceVolumeFrom] = useState('');
  const [sourceVolumeTo, setSourceVolumeTo] = useState('');
  const [targetVolume, setTargetVolume] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [data, setData] = useState<BulkSkuVolumeData>(emptyData);
  const [dataKey, setDataKey] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const search = searchEnabled ? productSearch.trim() : '';
  const rangeFrom = parseVolume(sourceVolumeFrom);
  const rangeTo = parseVolume(sourceVolumeTo);
  const hasRange = Boolean(sourceVolumeFrom.trim() || sourceVolumeTo.trim());
  const rangeReady = rangeFrom !== null && rangeTo !== null && rangeFrom <= rangeTo;
  const selectionReady = Boolean(clientId) && (hasRange ? rangeReady : Boolean(search));
  // FIX: never submit IDs fetched for another client, range, search or refresh.
  const requestKey = JSON.stringify([clientId, sourceVolumeFrom, sourceVolumeTo, search, reloadKey, session.accessToken]);
  const currentData = dataKey === requestKey && selectionReady;
  const selectedCount = currentData ? selectedIds.size : 0;

  useEffect(() => {
    if (defaultClientId) {
      setClientId(defaultClientId);
    } else if (!clientId && clients.length === 1) {
      setClientId(clients[0].id);
    }
  }, [clientId, clients, defaultClientId]);

  useEffect(() => {
    setSelectedIds(new Set());
    setDataKey('');
    if (!clientId || (hasRange && !rangeReady)) {
      setData(emptyData);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    fetchBulkSkuVolume(session.accessToken, {
      clientId,
      sourceVolumeFrom: rangeReady ? rangeFrom : undefined,
      sourceVolumeTo: rangeReady ? rangeTo : undefined,
      search: search || undefined,
    })
      .then((result) => {
        if (!active) return;
        setData(result);
        setDataKey(requestKey);
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
  }, [requestKey]);

  const sourceLabel = useMemo(() => {
    const from = parseVolume(sourceVolumeFrom);
    const to = parseVolume(sourceVolumeTo);
    if (from === null || to === null) return `по запросу «${search}»`;
    return from === to
      ? `${formatVolume(from)} л`
      : `от ${formatVolume(from)} до ${formatVolume(to)} л`;
  }, [sourceVolumeFrom, sourceVolumeTo, search]);

  function changeClient(nextClientId: string) {
    setClientId(nextClientId);
    setSourceVolumeFrom('');
    setSourceVolumeTo('');
    setTargetVolume('');
    setProductSearch('');
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
    if (saving || loading) return;
    const normalizedTarget = Number(targetVolume.replace(',', '.'));
    const normalizedFrom = parseVolume(sourceVolumeFrom);
    const normalizedTo = parseVolume(sourceVolumeTo);
    if (!currentData || selectedCount === 0 || !Number.isFinite(normalizedTarget)
      || normalizedTarget < 0.001 || normalizedTarget > 1_000_000) {
      setError('Выберите клиента, диапазон или артикул / баркод, товары и укажите новый литраж от 0,001 до 1 000 000 л.');
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
        sourceVolumeFrom: normalizedFrom ?? undefined,
        sourceVolumeTo: normalizedTo ?? undefined,
        search: search || undefined,
        skuIds: [...selectedIds],
        newVolumeLiters: normalizedTarget,
      });
      setMessage(`Готово: литраж изменён у ${result.updated} товаров. Габариты карточек не изменялись.`);
      if (hasRange) {
        setSourceVolumeFrom(String(result.newVolumeLiters));
        setSourceVolumeTo(String(result.newVolumeLiters));
      }
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
        <button className="icon-button" type="button" disabled={saving} onClick={() => setReloadKey((current) => current + 1)} title="Обновить данные">
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </div>

      <form className={`catalog-volume-editor__form${searchEnabled ? ' catalog-volume-editor__form--search' : ''}`} onSubmit={(event) => void apply(event)}>
        <label>
          <span>Клиент</span>
          <select value={clientId} onChange={(event) => changeClient(event.target.value)} disabled={saving} required>
            <option value="">Выберите клиента</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.code} · {client.name}</option>
            ))}
          </select>
        </label>
        {searchEnabled ? (
          <label>
            <span>Артикул / баркод</span>
            <input
              type="text"
              value={productSearch}
              maxLength={200}
              onChange={(event) => {
                setProductSearch(event.target.value);
                setMessage('');
                setError('');
              }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}
              disabled={!clientId || saving}
              placeholder="Введите или сканируйте"
            />
          </label>
        ) : null}
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
            disabled={!clientId || saving}
            placeholder="От"
            required={!search}
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
            disabled={!clientId || saving}
            placeholder="До"
            required={!search}
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
            disabled={saving}
            onChange={(event) => setTargetVolume(event.target.value)}
            placeholder="Например, 3.5"
            required
          />
        </label>
        <button className="primary-button" type="submit" disabled={saving || loading || selectedCount === 0}>
          <Save size={16} aria-hidden="true" />
          <span>{saving ? 'Изменяю…' : `Изменить у ${selectedCount}`}</span>
        </button>
      </form>

      {searchEnabled ? <p>Найдите товар по артикулу или баркоду и отметьте нужные позиции. Диапазон литража необязателен.</p> : null}
      {hasRange && !rangeReady ? <p className="form-error">Укажите обе границы корректного диапазона литража или очистите их для поиска по товару.</p> : null}
      {loading ? <p role="status">Загрузка товаров…</p> : null}

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      {currentData ? (
        <div className="catalog-volume-editor__results">
          <div className="catalog-volume-editor__summary">
            <span><CheckCheck size={16} aria-hidden="true" /> Найдено: {data.total} · выбрано: {selectedIds.size}</span>
            <button className="text-button" type="button" disabled={saving || loading} onClick={() => toggleAll(selectedIds.size !== data.items.length)}>
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
                      disabled={saving || loading}
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
                        disabled={saving || loading}
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
                  <tr><td colSpan={5}>Товаров по выбранным условиям нет</td></tr>
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
  return Number.isFinite(parsed) && parsed >= 0.001 && parsed <= 1_000_000 ? parsed : null;
}

function formatDimensions(item: { lengthCm: string | number | null; widthCm: string | number | null; heightCm: string | number | null }) {
  const dimensions = [item.lengthCm, item.widthCm, item.heightCm].map((value) => Number(value));
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) return 'Не указаны';
  return `${dimensions.map((value) => formatVolume(value)).join(' × ')} см`;
}

function readableError(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}
