import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Reconciliation } from './InventoryPanel';

const fixture = (review = true, canConfirm = true) => ({
  canManage: true, canConfirmKiz: canConfirm,
  historySessions: [{ id: 'saved-session', type: 'BOX_CHECK', status: 'COMPLETED', boxes: [{
    id: 'saved-audit', boxCode: 'FFL_G_LKB0707_045', status: 'MATCHED', countedByName: 'Гулрух',
    startedAt: '2026-09-15T10:35:50Z', completedAt: '2026-09-15T10:44:15Z',
    kizReview: review ? { required: true, orderId: '5765104936', message: 'Количество проверено, но состав КИЗ не подтверждён.' } : undefined,
    lines: [{ id: 'line', skuName: 'Оксфорд', internalSku: 'sku', expectedQuantity: 7, countedQuantity: 7, decision: 'KEEP_SYSTEM' }],
  }] }],
});
const render = (review = true, canConfirm = true) => renderToStaticMarkup(<Reconciliation
  dashboard={fixture(review, canConfirm) as never} session={{ accessToken: 'test' } as never} onChanged={async () => {}} />);

it('shows a completed 7-of-7 check with different KIZs in WMS actualization', () => {
  // TEST: Gulruh's saved scan was hidden as successful, forcing Sonya to scan the box again.
  const html = render();
  expect(html).toContain('FFL_G_LKB0707_045');
  expect(html).toContain('Гулрух');
  expect(html).toContain('5765104936');
  expect(html).toContain('Подтвердить состав по сканам');
  expect(html).not.toContain('Коробов с ошибками нет');
});
it('still hides genuinely matching checks without pending KIZ review', () => {
  // TEST: legacy and feature-disabled responses preserve the existing list behavior.
  expect(render(false)).not.toContain('FFL_G_LKB0707_045');
});
it('shows the pending check without an approval button to a manager without administrator authority', () => {
  // TEST: reading the discrepancy does not authorize rewriting KIZ ownership.
  expect(render(true, false)).toContain('FFL_G_LKB0707_045');
  expect(render(true, false)).not.toContain('Подтвердить состав по сканам');
});
it('shows the source debit warning before the KIZ approval button', () => {
  // TEST: administrator sees the stock effect in both boxes before confirmation.
  const dashboard = fixture();
  Object.assign(dashboard.historySessions[0].boxes[0], { kizTransferWarnings: ['КИЗ числится в 177, отсканирован в 181. Будет списана 1 шт. из 177.'] });
  const html = renderToStaticMarkup(<Reconciliation dashboard={dashboard as never} session={{accessToken:'test'} as never} onChanged={async()=>{}} />);
  expect(html).toContain('КИЗ числится в 177');
  expect(html.indexOf('КИЗ числится в 177')).toBeLessThan(html.indexOf('Подтвердить состав по сканам'));
});
