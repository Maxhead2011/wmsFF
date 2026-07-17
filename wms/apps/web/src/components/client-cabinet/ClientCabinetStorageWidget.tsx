import { RefreshCw, Warehouse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchStorageOverview, type ClientSummary, type StorageOverview } from '../../lib/api';
import { formatCabinetMoney, formatCabinetNumber } from './clientCabinetFormat';

type ClientCabinetStorageWidgetProps = {
  accessToken: string;
  client: ClientSummary;
};

type StorageWidgetState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  overview: StorageOverview | null;
  error?: string;
};

export function ClientCabinetStorageWidget({ accessToken, client }: ClientCabinetStorageWidgetProps) {
  const [state, setState] = useState<StorageWidgetState>({ status: 'idle', overview: null });
  const [periodTo, setPeriodTo] = useState(today());
  const periodFrom = monthStart(periodTo);

  useEffect(() => {
    if (!client.storageAccountingEnabled) {
      setState({ status: 'ready', overview: null });
      return;
    }

    let isActive = true;
    setState((current) => ({ ...current, status: current.overview ? 'loading' : 'loading', error: undefined }));

    async function loadStorage() {
      try {
        const overview = await fetchStorageOverview(accessToken, {
          clientId: client.id,
          periodFrom,
          periodTo,
        });
        if (isActive) {
          setState({ status: 'ready', overview });
        }
      } catch (caught) {
        if (isActive) {
          setState({
            status: 'error',
            overview: null,
            error: caught instanceof Error ? caught.message : 'Не удалось загрузить хранение.',
          });
        }
      }
    }

    void loadStorage();

    return () => {
      isActive = false;
    };
  }, [accessToken, client.id, client.storageAccountingEnabled, periodFrom, periodTo]);

  function reload() {
    if (!client.storageAccountingEnabled) {
      return;
    }
    const nextDate = today();
    if (nextDate !== periodTo) {
      setPeriodTo(nextDate);
      return;
    }

    setPeriodTo(nextDate);
    setState((current) => ({ ...current, status: 'loading', error: undefined }));
    void fetchStorageOverview(accessToken, {
      clientId: client.id,
      periodFrom,
      periodTo: nextDate,
    })
      .then((overview) => setState({ status: 'ready', overview }))
      .catch((caught) =>
        setState({
          status: 'error',
          overview: null,
          error: caught instanceof Error ? caught.message : 'Не удалось загрузить хранение.',
        }),
      );
  }

  const overview = state.overview;
  const tariff = overview?.tariffRubPerLiterDay ?? numberValue(client.storagePriceRubPerLiterDay);
  const periodLabel = `с ${formatDate(periodFrom)} по ${formatDate(periodTo)}`;

  return (
    <section className="client-storage-widget" aria-label="Хранение клиента">
      <div className="client-storage-widget__heading">
        <div>
          <span>Хранение</span>
          <strong>{periodLabel}</strong>
        </div>
        <div className="client-storage-widget__status">
          <span className={client.storageAccountingEnabled ? 'status status--ready' : 'status status--planned'}>
            {client.storageAccountingEnabled ? 'включено' : 'отключено'}
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={reload}
            disabled={!client.storageAccountingEnabled || state.status === 'loading'}
            title="Обновить хранение"
            aria-label="Обновить хранение"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {!client.storageAccountingEnabled ? <p className="panel-message">Учет хранения для клиента отключен.</p> : null}
      {state.status === 'loading' && !overview ? <p className="panel-message">Загружаю хранение.</p> : null}
      {state.status === 'error' ? <p className="panel-message panel-message--error">{state.error}</p> : null}

      {client.storageAccountingEnabled ? (
        <div className="client-storage-widget__metrics">
          <StorageMetric label="Литров сейчас" value={formatCabinetNumber(overview?.totals.totalLiters ?? 0)} />
          <StorageMetric label="Литро-дней" value={formatCabinetNumber(overview?.totals.literDays ?? 0)} />
          <StorageMetric label="К оплате за период" value={`${formatCabinetMoney(overview?.totals.storageCostRub ?? 0)} ₽`} />
          <StorageMetric label="Тариф" value={`${formatCabinetNumber(tariff)} ₽/л`} />
          <StorageMetric label="SKU" value={formatCabinetNumber(overview?.totals.skuCount ?? 0)} />
          <StorageMetric label="Единиц" value={formatCabinetNumber(overview?.totals.quantity ?? 0)} />
        </div>
      ) : null}

      <Warehouse className="client-storage-widget__mark" size={76} aria-hidden="true" />
    </section>
  );
}

function StorageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

function numberValue(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthStart(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-/);
  return match ? `${match[1]}-${match[2]}-01` : today().replace(/-\d{2}$/, '-01');
}
