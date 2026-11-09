import React from 'react';
import { Send } from 'lucide-react';
import { FbsShippingEditor } from './FbsShippingEditor';
import type { FbsSupplyDeliveryOptions, FbsOrderSummary } from '../../lib/api';
const fbsLocalIsoDate = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(value);
const formatFbsPenaltyDate = (value: string) => value.split('-').reverse().join('.');

export function canSubmitFbsSupplyDelivery(
  options: Pick<FbsSupplyDeliveryOptions, 'requiredDestinationOfficeId' | 'blockers'>,
  destinationOfficeId: string,
  plannedDeliveryDate: string,
) {
  // FIX: require the WB destination and a real calendar date before sending.
  const date = new Date(`${plannedDeliveryDate}T00:00:00.000Z`);
  return Boolean(
    options.blockers.length === 0 &&
      options.requiredDestinationOfficeId &&
      destinationOfficeId === options.requiredDestinationOfficeId &&
      /^\d{4}-\d{2}-\d{2}$/.test(plannedDeliveryDate) &&
      Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === plannedDeliveryDate,
  );
}

export function FbsSupplyDeliveryDialog({
  accessToken, clientId,
  state,
  isSubmitting,
  onOfficeChange,
  onDateChange,
  onCancel,
  onSubmit,
}: {
  accessToken: string; clientId: string;
  state: {
    orders: FbsOrderSummary[];
    options: FbsSupplyDeliveryOptions;
    destinationOfficeId: string;
    plannedDeliveryDate: string;
    error: string;
  };
  isSubmitting: boolean;
  onOfficeChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const supplyCount = state.options.supplies.length;
  const itemCount = state.options.supplies.reduce((sum, supply) => sum + supply.itemCount, 0);
  const canSubmit = canSubmitFbsSupplyDelivery(
    state.options,
    state.destinationOfficeId,
    state.plannedDeliveryDate,
  );
  return (
    <div className="fbs-assembly-dialog-backdrop" role="presentation">
      <section
        className="fbs-assembly-dialog fbs-supply-delivery-dialog"
        style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 'min(820px, calc(100vw - 32px))', maxHeight: '90vh', overflowY: 'auto' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fbs-supply-delivery-title"
      >
        <style>{`.fbs-supply-delivery-dialog > *{flex-shrink:0}
          .fbs-supply-delivery-dialog .wb-shipping-editor{display:grid;gap:10px;min-width:0;width:100%;box-sizing:border-box}
          .fbs-supply-delivery-dialog .wb-shipping-editor label{display:grid;gap:6px;font-size:13px;font-weight:600}
          .fbs-supply-delivery-dialog .wb-shipping-editor input,.fbs-supply-delivery-dialog .wb-shipping-editor select{width:100%;min-width:0;box-sizing:border-box;border:1px solid #dbe3eb;border-radius:9px;padding:10px 12px;font:inherit;background:var(--input-bg,#fff);color:inherit}
          .fbs-supply-delivery-dialog .wb-shipping-editor p{margin:0;font-size:13px;overflow-wrap:anywhere}
          .fbs-supply-delivery-dialog button.button{border:1px solid #dbe3eb;border-radius:10px;padding:10px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;background:var(--surface,#fff);color:inherit}
          .fbs-supply-delivery-dialog button.button-primary{background:#7038d5;color:white;border-color:#7038d5}
          .fbs-supply-delivery-dialog button:disabled{opacity:.5;cursor:default}
          .fbs-supply-delivery-dialog .fbs-assembly-dialog__heading{min-width:0;flex:1}
          .fbs-supply-delivery-dialog .fbs-assembly-dialog__heading h3{font-size:22px;margin:4px 0}
          .fbs-supply-delivery-dialog .fbs-assembly-dialog__actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}`}</style>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div className="fbs-assembly-dialog__icon fbs-supply-delivery-dialog__icon">
          <Send size={23} aria-hidden="true" />
        </div>
        <div className="fbs-assembly-dialog__heading">
          <p className="eyebrow">Передача поставки в Wildberries</p>
          <h3 id="fbs-supply-delivery-title">{state.options.shippingPointsEnabled ? "Пункт сдачи и грузоместа WB" : "Подтвердите склад и дату"}</h3>
          <p>{supplyCount} поставк(и) · {state.orders.length} заказов · {itemCount} единиц</p>
        </div>
        </div>

        <div className="fbs-supply-delivery-dialog__fields">
          <label>
            <span>Склад назначения WB</span>
            <select
              value={state.destinationOfficeId}
              onChange={(event) => onOfficeChange(event.target.value)}
              disabled={isSubmitting}
            >
              <option value="">Выберите склад</option>
              {state.options.offices.map((office) => (
                <option key={office.id} value={office.id} disabled={!office.compatible}>
                  {office.name}{office.city ? ` · ${office.city}` : ''}{!office.compatible ? ' · другая поставка' : ''}
                </option>
              ))}
            </select>
            <small>
              WMS загрузил склады из WB. Выбрать можно только склад, закреплённый за текущими заказами и поставкой.
            </small>
          </label>
          <label>
            <span>Плановая дата доставки</span>
            <input
              type="date"
              min={fbsLocalIsoDate(new Date())}
              value={state.plannedDeliveryDate}
              onChange={(event) => onDateChange(event.target.value)}
              disabled={isSubmitting}
            />
            <small>
              {state.options.shippingPointsEnabled ? "Выберите дату, затем сохраните её вместе с пунктом сдачи в WB ниже." : "Дата сохраняется в WMS для логистики. Склад повторно сверяется с WB непосредственно перед отправкой."}
              {state.options.earliestWbDeliveryDate
                ? ` Ближайшая дата по выбранным заказам WB: ${formatFbsPenaltyDate(state.options.earliestWbDeliveryDate)}.`
                : ''}
            </small>
          </label>
        </div>

        <div className="fbs-supply-delivery-dialog__supplies">
          {state.options.supplies.map((supply) => (
            <div key={`${supply.connectionId}:${supply.supplyId}`}>
              <strong>{supply.supplyId}</strong>
              <span>{supply.destinationOfficeName || `Склад WB №${supply.destinationOfficeId ?? '—'}`}</span>
              <small>{supply.orderCount} заказов · {supply.itemCount} единиц</small>
            </div>
          ))}
        </div>

        {state.options.shippingPointsEnabled ? state.options.supplies.map((supply) => (
          <FbsShippingEditor key={`${supply.connectionId}:${supply.supplyId}:${state.plannedDeliveryDate}`}
            accessToken={accessToken} supplyId={supply.supplyId} pointId={supply.shippingPointId}
            cargoIds={supply.cargoPlaceIds} disabled={isSubmitting}
            payload={{ clientId, plannedDeliveryDate: state.plannedDeliveryDate,
              orders: state.orders.filter((order) => order.connectionId === supply.connectionId && order.supplyId === supply.supplyId).map((order) => ({ connectionId: order.connectionId, id: order.id })) }} />
        )) : null}

        {state.options.blockers.map((blocker) => (
          <p className="fbs-assembly-dialog__warning" key={blocker}>{blocker}</p>
        ))}
        {state.error ? <p className="fbs-assembly-dialog__warning">{state.error}</p> : null}

        <div className="fbs-assembly-dialog__actions">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={isSubmitting}>
            Отмена
          </button>
          <button type="button" className="button button-primary" onClick={onSubmit} disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Проверяю и передаю…' : 'Подтвердить и передать WB'}
          </button>
        </div>
      </section>
    </div>
  );
}

