import type { ClientRequestAvailabilityPreview } from '../../lib/api';

// FIX: retain the displayed preview, including zero shortages, at the moment of the click.
export function ozonStockDecision(stock: ClientRequestAvailabilityPreview, adjust: boolean) {
  return JSON.stringify({
    mode: adjust ? 'OPEN_CORRECTION' : 'AS_IS',
    lines: stock.lines.map(({skuId, requestedQuantity, availableQuantity, shortageQuantity}) =>
      ({skuId, requestedQuantity, availableQuantity, shortageQuantity})),
  });
}
