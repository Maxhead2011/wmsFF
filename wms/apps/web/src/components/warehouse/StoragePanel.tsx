import { ChevronDown, Download, Filter, ReceiptText, RefreshCw, Save } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  downloadStorageOverviewXlsx,
  fetchClients,
  fetchStorageOverview,
  generateStorageCharge,
  updateStorageTariff,
  type AuthSession,
  type BillingChargeSummary,
  type ClientSummary,
  type StorageOverview,
} from '../../lib/api';

type StoragePanelProps = {
  session: AuthSession;
};

export function StoragePanel({ session }: StoragePanelProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientId] = useState('');
  const [periodFrom, setPeriodFrom] = useState(monthStart());
  const [periodTo, setPeriodTo] = useState(today());
  const [tariff, setTariff] = useState('0');
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [storageCharge, setStorageCharge] = useState<BillingChargeSummary | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isSavingTariff, setSavingTariff] = useState(false);
  const [isCharging, setCharging] = useState(false);
  const [areControlsOpen, setControlsOpen] = useState(false);
  const selectedClient = useMemo(() => clients.find((client) => client.id === clientId) ?? null, [clientId, clients]);
  const storageEnabled = selectedClient?.storageAccountingEnabled === true;

  useEffect(() => {
    let isActive = true;

    async function loadClients() {
      try {
        const list = await fetchClients(session.accessToken);
        if (!isActive) {
          return;
        }
        setClients(list);
        setClientId((current) => (list.some((client) => client.id === current) ? current : list[0]?.id ?? ''));
      } catch (caught) {
        if (isActive) {
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
        }
      }
    }

    void loadClients();

    return () => {
      isActive = false;
    };
  }, [session.accessToken]);

  useEffect(() => {
    if (selectedClient) {
      setTariff(String(numberValue(selectedClient.storagePriceRubPerLiterDay)));
    }
  }, [selectedClient]);

  useEffect(() => {
    setStorageCharge(null);
  }, [clientId, periodFrom, periodTo]);

  useEffect(() => {
    if (clientId) {
      void loadOverview();
    }
  }, [clientId]);

  async function loadOverview(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!clientId) {
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const next = await fetchStorageOverview(session.accessToken, {
        clientId,
        periodFrom,
        periodTo,
      });
      setOverview(next);
      setTariff(String(next.tariffRubPerLiterDay));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось рассчитать хранение.');
    } finally {
      setLoading(false);
    }
  }

  async function saveTariff() {
    if (!clientId) {
      return;
    }
    if (!storageEnabled) {
      setError('У выбранного клиента отключен учет хранения. Включите галочку в настройках клиента.');
      return;
    }

    const price = Number(tariff);
    if (!Number.isFinite(price) || price < 0) {
      setError('Тариф должен быть числом не меньше 0.');
      return;
    }

    setSavingTariff(true);
    setError('');
    setMessage('');
    try {
      const updated = await updateStorageTariff(session.accessToken, clientId, {
        storagePriceRubPerLiterDay: price,
      });
      setClients((current) =>
        current.map((client) =>
          client.id === updated.id
            ? {
                ...client,
                storageAccountingEnabled: updated.storageAccountingEnabled,
                storagePriceRubPerLiterDay: updated.storagePriceRubPerLiterDay,
              }
            : client,
        ),
      );
      setStorageCharge(null);
      await loadOverview();
      setMessage('Тариф хранения сохранен.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить тариф.');
    } finally {
      setSavingTariff(false);
    }
  }

  async function createStorageCharge() {
    if (!clientId) {
      return;
    }
    if (!storageEnabled) {
      setError('У выбранного клиента отключен учет хранения. Включите галочку в настройках клиента.');
      return;
    }

    const price = Number(tariff);
    if (!Number.isFinite(price) || price < 0) {
      setError('Тариф должен быть числом не меньше 0.');
      return;
    }

    setCharging(true);
    setError('');
    setMessage('');
    try {
      const charge = await generateStorageCharge(session.accessToken, {
        clientId,
        periodFrom,
        periodTo,
        unitPriceRub: price,
        approve: true,
        comment: 'Начисление хранения из раздела Склад и операции.',
      });
      setStorageCharge(charge);
      await loadOverview();
      setMessage(`Начисление хранения создано в биллинге: ${formatMoney(Number(charge.totalRub))}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось начислить хранение.');
    } finally {
      setCharging(false);
    }
  }

  async function downloadStorageXlsx() {
    if (!clientId) {
      return;
    }

    setError('');
    try {
      const blob = await downloadStorageOverviewXlsx(session.accessToken, {
        clientId,
        periodFrom,
        periodTo,
      });
      const clientCode = selectedClient?.code ?? 'client';
      downloadBlob(blob, `storage-${safeDownloadName(clientCode)}-${periodFrom}-${periodTo}.xlsx`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось скачать XLSX по хранению.');
    }
  }

  return (
    <section className="storage-panel" aria-label="Хранение">
      <div className="warehouse-subheading">
        <div>
          <h3>Хранение</h3>
          <span>
            {selectedClient ? `${selectedClient.name} · ${periodFrom} - ${periodTo}` : 'Остатки клиента, литраж и стоимость хранения за период'}
          </span>
        </div>
        <button
          className="icon-text-button storage-controls-toggle"
          type="button"
          onClick={() => setControlsOpen((current) => !current)}
          aria-expanded={areControlsOpen}
          title={areControlsOpen ? 'Свернуть параметры' : 'Показать параметры'}
        >
          <Filter size={16} aria-hidden="true" />
          <span>{areControlsOpen ? 'Свернуть параметры' : 'Параметры'}</span>
          <ChevronDown className="storage-controls-toggle__chevron" size={16} aria-hidden="true" />
        </button>
      </div>

      {areControlsOpen ? (
        <form className="storage-controls" onSubmit={(event) => void loadOverview(event)}>
          <label>
            <span>Клиент</span>
            <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} · {client.name}
                  {client.storageAccountingEnabled ? '' : ' · хранение отключено'}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Период с</span>
            <input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} />
          </label>
          <label>
            <span>Период по</span>
            <input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} />
          </label>
          <label>
            <span>₽ / литр в сутки</span>
            <input
              min="0"
              step="0.0001"
              type="number"
              value={tariff}
              onChange={(event) => setTariff(event.target.value)}
            />
          </label>
          <div className="storage-actions">
            <button
              className="icon-text-button warehouse-secondary"
              type="button"
              onClick={() => void saveTariff()}
              disabled={!clientId || !storageEnabled || isSavingTariff}
            >
              <Save size={16} aria-hidden="true" />
              <span>{isSavingTariff ? 'Сохраняю' : 'Сохранить тариф'}</span>
            </button>
            <button className="primary-button" type="submit" disabled={!clientId || isLoading}>
              <RefreshCw size={16} aria-hidden="true" />
              <span>{isLoading ? 'Считаю' : 'Показать'}</span>
            </button>
            <button
              className="icon-text-button warehouse-secondary"
              type="button"
              onClick={() => void createStorageCharge()}
              disabled={!clientId || !storageEnabled || isCharging}
            >
              <ReceiptText size={16} aria-hidden="true" />
              <span>{isCharging ? 'Начисляю' : 'Начислить хранение'}</span>
            </button>
            <button className="icon-text-button warehouse-secondary" type="button" onClick={() => void downloadStorageXlsx()} disabled={!clientId}>
              <Download size={16} aria-hidden="true" />
              <span>XLSX</span>
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}
      {selectedClient && !storageEnabled ? (
        <p className="panel-message">У клиента отключен учет хранения. Хранение не требуется и начисление не создается.</p>
      ) : null}

      {overview ? (
        <>
          <div className="storage-summary">
            <Metric label="SKU" value={formatNumber(overview.totals.skuCount)} />
            <Metric label="Единиц" value={formatNumber(overview.totals.quantity)} />
            <Metric label="Литров сейчас" value={formatNumber(overview.totals.totalLiters)} />
            <Metric label="Литро-дней" value={formatNumber(overview.totals.literDays)} />
            <Metric label="К оплате" value={formatMoney(overview.totals.storageCostRub)} />
            <Metric label="В биллинге" value={storageCharge ? formatMoney(Number(storageCharge.totalRub)) : 'не начислено'} />
          </div>

          <div className="storage-table-wrap">
            <table className="data-table storage-table">
              <thead>
                <tr>
                  <th>Баркод</th>
                  <th>Наименование</th>
                  <th>Артикул МП</th>
                  <th>Размер</th>
                  <th>Габариты</th>
                  <th>Литров ед.</th>
                  <th>Остаток</th>
                  <th>Короба</th>
                  <th>Паллеты</th>
                  <th>Литро-дни</th>
                  <th>Стоимость</th>
                </tr>
              </thead>
              <tbody>
                {overview.rows.map((row) => (
                  <tr key={row.skuId}>
                    <td>{row.barcode || '-'}</td>
                    <td>
                      <strong>{row.name}</strong>
                      <span>{row.internalSku}</span>
                    </td>
                    <td>{row.marketplaceArticle || '-'}</td>
                    <td>{row.size || '-'}</td>
                    <td>{dimensions(row)}</td>
                    <td>{formatNumber(row.volumeLiters)}</td>
                    <td>{formatNumber(row.quantity)}</td>
                    <td title={row.boxCodes.join(', ')}>{row.boxesCount}</td>
                    <td title={row.palletCodes.join(', ')}>{row.palletsCount}</td>
                    <td>{formatNumber(row.literDays)}</td>
                    <td>{formatMoney(row.storageCostRub)}</td>
                  </tr>
                ))}
                {overview.rows.length === 0 ? (
                  <tr>
                    <td colSpan={11}>На хранении ничего не найдено.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function dimensions(row: { lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null }) {
  if (!row.lengthCm || !row.widthCm || !row.heightCm) {
    return '-';
  }
  return `${formatNumber(row.lengthCm)} × ${formatNumber(row.widthCm)} × ${formatNumber(row.heightCm)} см`;
}

function numberValue(value: string | number | null | undefined) {
  return value == null ? 0 : Number(value);
}

function formatNumber(value: string | number | null | undefined) {
  const numeric = numberValue(value);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(numeric);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(value);
}

function downloadBlob(blob: Blob, fileName: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function safeDownloadName(value: string) {
  return value.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '_');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
