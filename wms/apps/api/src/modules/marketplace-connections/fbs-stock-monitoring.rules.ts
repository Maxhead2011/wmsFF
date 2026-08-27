export type FbsStockMonitorEventType = 'SALE' | 'CANCEL' | 'RETURN';
export type FbsStockMonitorCheckStatus = 'SUCCESS' | 'ERROR' | 'PENDING' | 'UNAVAILABLE';
export type FbsStockMonitorOverallStatus = FbsStockMonitorCheckStatus;

export type FbsStockMonitorRuleInput = {
  eventType: FbsStockMonitorEventType;
  quantity: number;
  beforeAmount: number | null;
  currentAmount: number | null;
  expectedAfterAmount?: number | null;
  exactOrderMatched: boolean;
  exactReservationMatched?: boolean;
  exactReservationReleased?: boolean;
  nowMs: number;
  deadlineMs: number;
  attempt: number;
  maxAttempts: number;
  temporarilyUnavailable?: boolean;
  unavailableMessage?: string | null;
};

export type FbsStockMonitorRuleResult = {
  status: FbsStockMonitorCheckStatus;
  expectedAfterAmount: number | null;
  observedDelta: number | null;
  message: string | null;
};

// ADDED: one deterministic key makes repeated WB delivery idempotent.
export function fbsStockMonitorEventKey(input: {
  connectionId: string;
  orderId: string;
  skuId: string;
  eventType: FbsStockMonitorEventType;
}) {
  return [
    'WILDBERRIES',
    input.connectionId.trim(),
    input.orderId.trim(),
    input.skuId.trim(),
    input.eventType,
  ].join(':');
}

// ADDED: cancellation/return restore the quantity; sale removes it.
export function fbsStockMonitorExpectedAfter(
  beforeAmount: number | null,
  quantity: number,
  eventType: FbsStockMonitorEventType,
) {
  if (beforeAmount == null || !Number.isFinite(beforeAmount)) return null;
  const normalizedQuantity = Math.max(1, Math.trunc(quantity));
  return eventType === 'SALE'
    ? Math.max(0, Math.trunc(beforeAmount) - normalizedQuantity)
    : Math.max(0, Math.trunc(beforeAmount) + normalizedQuantity);
}

// ADDED: WB success needs the exact order plus the expected aggregate delta.
export function evaluateFbsStockMonitorWb(
  input: FbsStockMonitorRuleInput,
): FbsStockMonitorRuleResult {
  return evaluateAmountRule(input, false);
}

// ADDED: WMS may prove a sale through an exact reservation even before a
// physical balance movement; aggregate deltas remain a secondary proof.
export function evaluateFbsStockMonitorWms(
  input: FbsStockMonitorRuleInput,
): FbsStockMonitorRuleResult {
  const expectedAfterAmount = input.expectedAfterAmount ?? fbsStockMonitorExpectedAfter(
    input.beforeAmount,
    input.quantity,
    input.eventType,
  );
  if (input.temporarilyUnavailable) {
    return unavailableResult(expectedAfterAmount, input.unavailableMessage);
  }
  if (input.eventType === 'SALE' && input.exactReservationMatched) {
    return {
      status: 'SUCCESS',
      expectedAfterAmount,
      observedDelta: observedDelta(input.beforeAmount, input.currentAmount, input.eventType),
      message: null,
    };
  }
  if (
    input.eventType !== 'SALE' &&
    input.exactReservationReleased &&
    input.exactOrderMatched
  ) {
    return {
      status: 'SUCCESS',
      expectedAfterAmount,
      observedDelta: observedDelta(input.beforeAmount, input.currentAmount, input.eventType),
      message: null,
    };
  }
  return evaluateAmountRule(input, true);
}

export function fbsStockMonitorOverallStatus(
  wbStatus: FbsStockMonitorCheckStatus,
  wmsStatus: FbsStockMonitorCheckStatus,
): FbsStockMonitorOverallStatus {
  if (wbStatus === 'ERROR' || wmsStatus === 'ERROR') return 'ERROR';
  if (wbStatus === 'SUCCESS' && wmsStatus === 'SUCCESS') return 'SUCCESS';
  if (wbStatus === 'PENDING' || wmsStatus === 'PENDING') return 'PENDING';
  return 'UNAVAILABLE';
}

export function fbsStockMonitorNeedsRetry(status: FbsStockMonitorCheckStatus) {
  return status === 'PENDING' || status === 'UNAVAILABLE';
}

function evaluateAmountRule(
  input: FbsStockMonitorRuleInput,
  allowMatchedAggregate: boolean,
): FbsStockMonitorRuleResult {
  const expectedAfterAmount = input.expectedAfterAmount ?? fbsStockMonitorExpectedAfter(
    input.beforeAmount,
    input.quantity,
    input.eventType,
  );
  if (input.temporarilyUnavailable) {
    return unavailableResult(expectedAfterAmount, input.unavailableMessage);
  }
  if (input.beforeAmount == null || input.currentAmount == null || expectedAfterAmount == null) {
    return unavailableResult(expectedAfterAmount, 'Недостаточно снимков остатка для точной проверки.');
  }

  const amountMatched = input.eventType === 'SALE'
    ? input.currentAmount <= expectedAfterAmount
    : input.currentAmount >= expectedAfterAmount;
  if (input.exactOrderMatched && amountMatched) {
    return {
      status: 'SUCCESS',
      expectedAfterAmount,
      observedDelta: observedDelta(input.beforeAmount, input.currentAmount, input.eventType),
      message: null,
    };
  }

  const expired = input.nowMs >= input.deadlineMs || input.attempt >= input.maxAttempts;
  if (!expired) {
    return {
      status: 'PENDING',
      expectedAfterAmount,
      observedDelta: observedDelta(input.beforeAmount, input.currentAmount, input.eventType),
      message: amountMatched && !input.exactOrderMatched
        ? 'Количество изменилось, но нет достаточной связи с конкретным заказом.'
        : 'Ожидается синхронизация остатка.',
    };
  }

  const delta = observedDelta(input.beforeAmount, input.currentAmount, input.eventType);
  const required = Math.max(1, Math.trunc(input.quantity));
  const partial = delta != null && delta > 0 && delta < required;
  return {
    status: 'ERROR',
    expectedAfterAmount,
    observedDelta: delta,
    message: partial
      ? `Зафиксировано частичное изменение: ${delta} из ${required} ед.`
      : allowMatchedAggregate && !input.exactOrderMatched
        ? 'Не найдено резервирование этого заказа и не подтверждено связанное изменение остатка.'
        : 'Допустимое время ожидания истекло, ожидаемое изменение остатка не подтверждено.',
  };
}

function unavailableResult(
  expectedAfterAmount: number | null,
  message: string | null | undefined,
): FbsStockMonitorRuleResult {
  return {
    status: 'UNAVAILABLE',
    expectedAfterAmount,
    observedDelta: null,
    message: message || 'Проверка временно недоступна.',
  };
}

function observedDelta(
  beforeAmount: number | null,
  currentAmount: number | null,
  eventType: FbsStockMonitorEventType,
) {
  if (beforeAmount == null || currentAmount == null) return null;
  return eventType === 'SALE'
    ? Math.max(0, beforeAmount - currentAmount)
    : Math.max(0, currentAmount - beforeAmount);
}
