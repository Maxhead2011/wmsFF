import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Truck } from 'lucide-react';
import {
  createLogisticsDeliveryRequest,
  fetchLogisticsTariffSet,
  type AuthSession,
  type ClientRequestSummary,
  type ClientSummary,
  type LogisticsDeliveryRequestSummary,
  type LogisticsTariffSetDetail,
  type LogisticsTariffSetSummary,
} from '../../lib/api';

type LogisticsDeliveryFormProps = {
  clients: ClientSummary[];
  requests: ClientRequestSummary[];
  tariffs: LogisticsTariffSetSummary[];
  session: AuthSession;
  onCreated: (request: LogisticsDeliveryRequestSummary) => void;
};

type QuantityMode = 'boxes' | 'pallets';

const DEFAULT_LOGISTICS_ORIGIN = 'Москва';

export function LogisticsDeliveryForm({ clients, requests, tariffs, session, onCreated }: LogisticsDeliveryFormProps) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [requestId, setRequestId] = useState('');
  const [tariffSetId, setTariffSetId] = useState(tariffs[0]?.id ?? '');
  const [tariffDetail, setTariffDetail] = useState<LogisticsTariffSetDetail | null>(null);
  const [destination, setDestination] = useState('');
  const [quantityMode, setQuantityMode] = useState<QuantityMode>('boxes');
  const [quantity, setQuantity] = useState('1');
  const [desiredShipDate, setDesiredShipDate] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);

  const availableRequests = useMemo(
    () => requests.filter((request) => request.clientId === clientId && request.type === 'OUTBOUND'),
    [clientId, requests],
  );
  const selectedRequest = useMemo(
    () => availableRequests.find((request) => request.id === requestId) ?? null,
    [availableRequests, requestId],
  );
  const destinationOptions = useMemo(() => buildDestinationOptions(tariffDetail), [tariffDetail]);
  const packageCounts = useMemo(() => countRequestPackages(selectedRequest), [selectedRequest]);
  const isPackageDriven = Boolean(selectedRequest);
  const parsedQuantity = Number(quantity);
  const hasActualPackages = packageCounts.boxes + packageCounts.pallets > 0;
  const destinationExists = !destination.trim() || hasDestinationOption(destinationOptions, destination);
  const isUnknownDestination = Boolean(destination.trim() && destinationOptions.length > 0 && !destinationExists);
  const destinationListId = 'logistics-delivery-destinations';
  const canSubmit = Boolean(
    clientId &&
      destination.trim() &&
      (isPackageDriven ? hasActualPackages : Number.isInteger(parsedQuantity) && parsedQuantity > 0),
  );

  useEffect(() => {
    if (selectedRequest?.destinationCity) {
      setDestination(selectedRequest.destinationCity);
    }
  }, [selectedRequest?.destinationCity]);

  useEffect(() => {
    if (!tariffSetId) {
      setTariffDetail(null);
      return;
    }

    let isMounted = true;
    fetchLogisticsTariffSet(session.accessToken, tariffSetId)
      .then((detail) => {
        if (isMounted) {
          setTariffDetail(detail);
        }
      })
      .catch(() => {
        if (isMounted) {
          setTariffDetail(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [session.accessToken, tariffSetId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      // Русский комментарий: режим количества разворачиваем в одно поле, чтобы API сохранил короба или паллеты без двусмысленности.
      const created = await createLogisticsDeliveryRequest(session.accessToken, {
        clientId,
        requestId: requestId || undefined,
        tariffSetId: tariffSetId || undefined,
        destination: destination.trim(),
        desiredShipDate: desiredShipDate || undefined,
        comment: comment.trim() || undefined,
        ...(isPackageDriven ? {} : quantityMode === 'boxes' ? { boxes: parsedQuantity } : { pallets: parsedQuantity }),
      });
      onCreated(created);
      setDestination('');
      setQuantity('1');
      setComment('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать заявку на доставку.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="delivery-form" onSubmit={submit}>
      <div className="delivery-fields">
        <label>
          <span>Клиент</span>
          <select
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value);
              setRequestId('');
            }}
            required
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.code} · {client.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Исходящая заявка</span>
          <select value={requestId} onChange={(event) => setRequestId(event.target.value)}>
            <option value="">Без привязки</option>
            {availableRequests.map((request) => (
              <option key={request.id} value={request.id}>
                {request.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Тариф</span>
          <select value={tariffSetId} onChange={(event) => setTariffSetId(event.target.value)}>
            <option value="">Активный по дате</option>
            {tariffs.map((tariff) => (
              <option key={tariff.id} value={tariff.id}>
                {tariff.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Дата</span>
          <input type="date" value={desiredShipDate} onChange={(event) => setDesiredShipDate(event.target.value)} />
        </label>
      </div>

      <div className="delivery-fields delivery-fields--route">
        <label>
          <span>Откуда</span>
          <strong className="readonly-field">{DEFAULT_LOGISTICS_ORIGIN}</strong>
        </label>
        <label>
          <span>Куда</span>
          <input
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            list={destinationListId}
            placeholder="Начните вводить город"
            required
          />
          <datalist id={destinationListId}>
            {destinationOptions.map((city) => (
              <option key={city} value={city} />
            ))}
          </datalist>
        </label>
        <div className="quote-mode" role="tablist" aria-label="Единица доставки">
          <button className={quantityMode === 'boxes' ? 'active' : ''} disabled={isPackageDriven} type="button" onClick={() => setQuantityMode('boxes')}>
            Короба
          </button>
          <button
            className={quantityMode === 'pallets' ? 'active' : ''}
            disabled={isPackageDriven}
            type="button"
            onClick={() => setQuantityMode('pallets')}
          >
            Паллеты
          </button>
        </div>
        <label>
          <span>{isPackageDriven ? 'Фактические места' : 'Количество'}</span>
          {isPackageDriven ? (
            <strong className="readonly-field">{formatPackageCounts(packageCounts)}</strong>
          ) : (
            <input min="1" step="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          )}
        </label>
      </div>

      {isPackageDriven && !hasActualPackages ? (
        <p className="form-error">По выбранной заявке нет упаковочных мест. Сначала упакуйте ее на складе.</p>
      ) : null}

      {isUnknownDestination ? (
        <p className="logistics-route-warning">
          Города нет в тарифах. После создания заявка попадет фулфилменту на ручной расчет стоимости перевозки.
        </p>
      ) : null}

      <div className="delivery-footer">
        <label>
          <span>Комментарий</span>
          <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Пожелания по доставке" />
        </label>
        <button className="primary-button delivery-submit" type="submit" disabled={!canSubmit || isSubmitting}>
          <Truck size={16} aria-hidden="true" />
          <span>{isSubmitting ? 'Создаю' : 'Создать заявку'}</span>
        </button>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}

function countRequestPackages(request: ClientRequestSummary | null) {
  return (request?.packages ?? []).reduce(
    (result, pack) => {
      if (isPalletPackage(pack.packageType)) {
        result.pallets += 1;
      } else {
        result.boxes += 1;
      }
      return result;
    },
    { boxes: 0, pallets: 0 },
  );
}

function isPalletPackage(packageType?: string | null) {
  return ['PALLET', 'PALLETTE', 'ПАЛЛЕТ', 'ПАЛЛЕТА'].includes((packageType ?? '').trim().toUpperCase());
}

function formatPackageCounts(counts: { boxes: number; pallets: number }) {
  const parts: string[] = [];
  if (counts.boxes > 0) {
    parts.push(`${counts.boxes} кор.`);
  }
  if (counts.pallets > 0) {
    parts.push(`${counts.pallets} пал.`);
  }
  return parts.join(' / ') || 'нет упаковки';
}

function buildDestinationOptions(tariffSet: LogisticsTariffSetDetail | null) {
  if (!tariffSet) {
    return [];
  }

  const moscowDirections = tariffSet.directions.filter((direction) => isMoscowOrigin(direction.origin));
  const source = moscowDirections.length > 0 ? moscowDirections : tariffSet.directions;
  const options = new Map<string, string>();

  source.forEach((direction) => {
    const destination = direction.destination.trim();
    if (!destination) {
      return;
    }
    options.set(normalizeLogisticsPoint(destination), destination);
  });

  return [...options.values()].sort((left, right) => left.localeCompare(right, 'ru'));
}

function hasDestinationOption(options: string[], destination: string) {
  const normalized = normalizeLogisticsPoint(destination);
  return options.some((option) => normalizeLogisticsPoint(option) === normalized);
}

function isMoscowOrigin(origin: string) {
  const normalized = normalizeLogisticsPoint(origin);
  return normalized === normalizeLogisticsPoint(DEFAULT_LOGISTICS_ORIGIN) || normalized === 'москва' || normalized === 'moscow';
}

function normalizeLogisticsPoint(value: string) {
  return value.toLowerCase().replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
}
