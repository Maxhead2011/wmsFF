import { CheckCircle2, Info, Trash2, Truck, X } from 'lucide-react';
import { useState } from 'react';
import {
  deleteBillingStorageBreakdownDay,
  fetchBillingStorageBreakdown,
  type BillingChargeStatus,
  type BillingChargeSummary,
  type BillingStorageBreakdown,
} from '../../lib/api';
import { billingStatusLabel, billingStatusOptions, billingStatusTone, billingUnitLabel } from './billingMeta';

type BillingChargesTableProps = {
  accessToken: string;
  charges: BillingChargeSummary[];
  canWrite: boolean;
  onStatusChange: (chargeId: string, status: BillingChargeStatus) => void;
  onFbsLogisticsTripChange: (chargeId: string, extraTrip: boolean) => Promise<void>;
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

export function BillingChargesTable({
  accessToken,
  charges,
  canWrite,
  onStatusChange,
  onFbsLogisticsTripChange,
}: BillingChargesTableProps) {
  const [breakdown, setBreakdown] = useState<BillingStorageBreakdown | null>(null);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const [tripBusy, setTripBusy] = useState<string | null>(null);

  async function openStorageBreakdown(charge: BillingChargeSummary) {
    setBreakdownError(null);
    try {
      setBreakdown(await fetchBillingStorageBreakdown(accessToken, charge.id));
    } catch (caught) {
      setBreakdownError(errorMessage(caught));
    }
  }

  async function deleteStorageDay(date: string) {
    if (!breakdown) {
      return;
    }
    setBreakdownError(null);
    try {
      setBreakdown(await deleteBillingStorageBreakdownDay(accessToken, breakdown.chargeId, date));
    } catch (caught) {
      setBreakdownError(errorMessage(caught));
    }
  }

  return (
    <>
      {breakdownError ? <p className="form-error">{breakdownError}</p> : null}
      <div className="billing-table-wrap">
        <table className="data-table billing-table">
          <thead>
            <tr>
              <th>Начисление</th>
              <th>Клиент</th>
              <th>Кол-во</th>
              <th>Цена</th>
              <th>Сумма</th>
              <th>Статус</th>
              {canWrite ? <th>Процесс</th> : null}
            </tr>
          </thead>
          <tbody>
            {charges.map((charge) => {
              const trip = fbsLogisticsTrip(charge);
              return (
              <tr key={charge.id}>
                <td>
                  <strong>{charge.description}</strong>
                  <span>{charge.request?.title ?? charge.service?.code ?? 'ручное начисление'}</span>
                  <span>{chargeSourceLabel(charge)}</span>
                  <span>{formatDate(charge.serviceDate)}</span>
                  {trip ? (
                    <div className={`billing-fbs-trip billing-fbs-trip--${trip.charged ? 'charged' : 'combined'}`}>
                      <span>
                        <Truck size={14} aria-hidden="true" />
                        {trip.automaticPrimary
                          ? 'Основной выезд клиента за день'
                          : trip.extraTripOverride
                            ? 'Отдельный выезд указан вручную'
                            : 'Объединено с выездом клиента за этот день'}
                      </span>
                      {canWrite && charge.status === 'DRAFT' && !trip.automaticPrimary ? (
                        <button
                          type="button"
                          onClick={() => {
                            setTripBusy(charge.id);
                            Promise.resolve(
                              onFbsLogisticsTripChange(charge.id, !trip.extraTripOverride),
                            ).finally(() => setTripBusy((current) => current === charge.id ? null : current));
                          }}
                          disabled={tripBusy === charge.id}
                        >
                          {trip.extraTripOverride ? 'Объединить выезд' : 'Считать отдельным выездом'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {charge.source === 'STORAGE' ? (
                    <button className="icon-text-button billing-breakdown-button" type="button" onClick={() => void openStorageBreakdown(charge)}>
                      <Info size={15} aria-hidden="true" />
                      <span>Расшифровка</span>
                    </button>
                  ) : null}
                </td>
                <td>
                  <strong>{charge.client.code}</strong>
                  <span>{charge.client.name}</span>
                </td>
                <td>
                  {formatNumber(charge.quantity)} {billingUnitLabel(charge.unit)}
                </td>
                <td>{formatMoney(charge.unitPriceRub)} ₽</td>
                <td>
                  <strong>{formatMoney(charge.totalRub)} ₽</strong>
                </td>
                <td>
                  <span className={`status status--${billingStatusTone(charge.status)}`}>
                    {billingStatusLabel(charge.status)}
                  </span>
                  {charge.approvedBy ? <span>{charge.approvedBy.name}</span> : null}
                </td>
                {canWrite ? (
                  <td>
                    <label className="billing-status-select">
                      <CheckCircle2 size={15} aria-hidden="true" />
                      <select
                        value={charge.status}
                        onChange={(event) => onStatusChange(charge.id, event.target.value as BillingChargeStatus)}
                      >
                        {billingStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </td>
                ) : null}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {breakdown ? (
        <div className="billing-storage-modal" role="dialog" aria-modal="true" aria-label="Расшифровка хранения">
          <div className="billing-storage-modal__card">
            <div className="billing-storage-modal__heading">
              <div>
                <h3>Расшифровка хранения</h3>
                <span>
                  {breakdown.periodFrom ?? '-'} - {breakdown.periodTo ?? '-'}
                </span>
              </div>
              <button className="icon-button" type="button" onClick={() => setBreakdown(null)} aria-label="Закрыть">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="billing-storage-modal__metrics">
              <Metric label="Литро-дней" value={formatNumber(breakdown.quantity)} />
              <Metric label="Тариф" value={`${formatMoney(breakdown.unitPriceRub)} ₽`} />
              <Metric label="Сумма" value={`${formatMoney(breakdown.totalRub)} ₽`} />
            </div>
            <div className="billing-table-wrap billing-storage-modal__table">
              <table className="data-table billing-storage-detail-table">
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th>Дата</th>
                    <th>Документ</th>
                    <th>Описание</th>
                    <th>Количество</th>
                    <th>Сумма, ₽</th>
                    {canWrite && breakdown.canDeleteRows ? <th>Действие</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {breakdown.rows.map((row) => (
                    <tr key={row.date}>
                      <td>Услуга</td>
                      <td>{formatDate(row.date)}</td>
                      <td>{row.document}</td>
                      <td>{row.description}</td>
                      <td>
                        <strong>{formatNumber(row.literDays)}</strong>
                        <span>{formatNumber(row.totalLiters)} л, позиций {row.positions}</span>
                      </td>
                      <td>{formatMoney(row.totalRub)}</td>
                      {canWrite && breakdown.canDeleteRows ? (
                        <td>
                          <button className="icon-text-button" type="button" onClick={() => void deleteStorageDay(row.date)}>
                            <Trash2 size={15} aria-hidden="true" />
                            <span>Удалить</span>
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function formatNumber(value: string | number) {
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

function formatMoney(value: string | number) {
  return moneyFormatter.format(Number(value));
}

function chargeSourceLabel(charge: BillingChargeSummary) {
  if (charge.source === 'STORAGE') {
    return 'авто: хранение';
  }

  if (charge.source === 'LOGISTICS') {
    return 'авто: логистика';
  }

  if (charge.metadata?.packageBilling === true) {
    return 'авто: обработка заявки';
  }

  return 'ручное';
}

function fbsLogisticsTrip(charge: BillingChargeSummary) {
  const value = charge.metadata?.logisticsTrip;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const trip = value as Record<string, unknown>;
  return {
    automaticPrimary: trip.automaticPrimary === true,
    extraTripOverride: trip.extraTripOverride === true,
    charged: trip.charged === true,
  };
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Не удалось выполнить операцию.';
}
