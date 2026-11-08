import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FbsOrderRow } from './FbsPanel';
const order = { id: '123', marketplace: 'WILDBERRIES', category: 'active', supplierStatus: 'confirm', barcodes: ['1234567890123'],
  itemCount: 1, storageBoxes: [], statusLabel: 'Новый', requiredMeta: [], optionalMeta: [],
  product: { name: 'Ткань белая 3 м' }, billing: { breakdown: {} } };
function html(reservation: any) { return renderToStaticMarkup(<table><tbody><FbsOrderRow {...{ order: { ...order, reservation }, showBoxes: true, now: 0 } as any} /></tbody></table>); }
// TEST: actual order row shows the fabric mode and cannot offer hiding a false shortage.
it('shows cut-on-demand without missing-box warnings or a false stock promise', () => {
  const text = html({ status: 'FABRIC_ON_DEMAND', withoutBox: true });
  expect(text).toContain('Нарезка по факту'); expect(text).toContain('Метры проверяются при сборке');
  for (const wrong of ['Резерв ожидает', 'короб не найден', 'Скрыть из виду', 'Зарезервировано со склада']) expect(text).not.toContain(wrong);
});
it('keeps genuine ordinary-stock shortages visible', () => {
  const text = html({ status: 'WAITING_STOCK', withoutBox: false, problem: 'Нет доступного товара' });
  for (const expected of ['Резерв ожидает', 'короб не найден', 'Скрыть из виду', 'Нет доступного товара']) expect(text).toContain(expected);
});
