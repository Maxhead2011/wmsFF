import { Clock3, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchFbsOrders,
  type ClientFbsOrders,
} from '../../lib/api';

type DeliveryGaugeState =
  | { status: 'loading'; data: null; error: '' }
  | { status: 'ready'; data: ClientFbsOrders; error: '' }
  | { status: 'error'; data: null; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function ClientFbsDeliveryGauge({
  accessToken,
  clientId,
}: {
  accessToken: string;
  clientId: string;
}) {
  const [state, setState] = useState<DeliveryGaugeState>({
    status: 'loading',
    data: null,
    error: '',
  });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', data: null, error: '' });
    void fetchFbsOrders(accessToken, clientId)
      .then((data) => {
        if (active) setState({ status: 'ready', data, error: '' });
      })
      .catch((caught) => {
        if (!active) return;
        setState({
          status: 'error',
          data: null,
          error:
            caught instanceof Error
              ? caught.message
              : 'Не удалось рассчитать время доставки FBS.',
        });
      });
    return () => {
      active = false;
    };
  }, [accessToken, clientId]);

  const metric = useMemo(
    () => calculateDeliveryMetric(state.data),
    [state.data],
  );

  if (state.status === 'loading') {
    return (
      <section className="client-fbs-delivery client-fbs-delivery--loading">
        <Clock3 size={20} aria-hidden="true" />
        <span>Рассчитываю среднее время доставки FBS…</span>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="client-fbs-delivery client-fbs-delivery--empty">
        <Truck size={20} aria-hidden="true" />
        <div>
          <strong>Среднее время доставки FBS</strong>
          <span>{state.error}</span>
        </div>
      </section>
    );
  }

  if (!state.data.connected || !metric) {
    return (
      <section className="client-fbs-delivery client-fbs-delivery--empty">
        <Truck size={20} aria-hidden="true" />
        <div>
          <strong>Среднее время доставки FBS</strong>
          <span>
            {!state.data.connected
              ? 'Маркетплейс ещё не подключён.'
              : 'Показатель появится после первой передачи FBS-поставки в Wildberries.'}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`client-fbs-delivery client-fbs-delivery--${metric.tone}`}
      aria-label="Среднее время доставки FBS"
    >
      <div className="client-fbs-delivery__heading">
        <span className="client-fbs-delivery__icon">
          <Truck size={21} aria-hidden="true" />
        </span>
        <div>
          <span>FBS · от получения заказа до передачи Wildberries</span>
          <strong>{formatDeliveryDuration(metric.averageMs)}</strong>
        </div>
        <small>{metric.sampleSize} завершённых заказов</small>
      </div>

      <div className="client-fbs-delivery__gauge">
        <div className="client-fbs-delivery__track">
          <span
            className="client-fbs-delivery__marker"
            style={{ left: `${metric.position}%` }}
            title={`Среднее: ${formatDeliveryDuration(metric.averageMs)}`}
          />
        </div>
        <div className="client-fbs-delivery__scale" aria-hidden="true">
          <span>0 ч</span>
          <span>12 ч</span>
          <span>19 ч</span>
          <span>24 ч+</span>
        </div>
      </div>

      <p>
        Быстрее всего: {formatDeliveryDuration(metric.fastestMs)} · дольше
        всего: {formatDeliveryDuration(metric.slowestMs)}
      </p>
    </section>
  );
}

function calculateDeliveryMetric(data: ClientFbsOrders | null) {
  if (!data) return null;
  const durations = data.orders.flatMap((order) => {
    const createdAt = validTimestamp(order.createdAt);
    const sentToWbAt = validTimestamp(order.shipmentPlan?.sentToWbAt);
    if (
      createdAt === null ||
      sentToWbAt === null ||
      sentToWbAt < createdAt
    ) {
      return [];
    }
    return [sentToWbAt - createdAt];
  });
  if (durations.length === 0) return null;
  const averageMs =
    durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
  return {
    averageMs,
    fastestMs: Math.min(...durations),
    slowestMs: Math.max(...durations),
    sampleSize: durations.length,
    position: Math.min(100, Math.max(0, (averageMs / DAY_MS) * 100)),
    tone:
      averageMs < 12 * 60 * 60 * 1000
        ? 'fast'
        : averageMs < 19 * 60 * 60 * 1000
          ? 'slow'
          : 'critical',
  } as const;
}

function validTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDeliveryDuration(milliseconds: number) {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}
