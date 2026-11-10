import { afterEach, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fbsCompleteLabelsSupported, FbsOrderRow } from './FbsPanel';
afterEach(() => vi.unstubAllEnvs());
// TEST: Ozon document actions are enabled only in the own-WMS rollout.
it('supports Ozon and WB while retaining sold installation behavior', () => {
  vi.stubEnv('VITE_FBS_COMPACT_MENU_ENABLED', 'true');
  expect(fbsCompleteLabelsSupported({ marketplace: 'OZON' })).toBe(true);
  expect(fbsCompleteLabelsSupported({ marketplace: 'WILDBERRIES' })).toBe(true);
  expect(fbsCompleteLabelsSupported({ marketplace: 'YANDEX' })).toBe(false);
  vi.stubEnv('VITE_FBS_COMPACT_MENU_ENABLED', 'false');
  expect(fbsCompleteLabelsSupported({ marketplace: 'OZON' })).toBe(false);
  expect(fbsCompleteLabelsSupported({ marketplace: 'WILDBERRIES' })).toBe(true);
});
// TEST: render the actual ready-to-ship Ozon row, including both actions.
it('shows download and print in an Ozon awaiting-deliver row', () => {
  vi.stubEnv('VITE_FBS_COMPACT_MENU_ENABLED', 'true');
  const order = { id: 'posting-1', marketplace: 'OZON', category: 'active', supplierStatus: 'awaiting_deliver',
    barcodes: ['1234567890123'], itemCount: 1, storageBoxes: [], requiredMeta: [], optionalMeta: [],
    product: { name: 'Ткань' }, billing: { breakdown: {} } };
  const html = renderToStaticMarkup(<table><tbody><FbsOrderRow {...{ order, showBoxes: true, now: 0 } as any} /></tbody></table>);
  expect(html).toContain('Скачать все ШК'); expect(html).toContain('Печать всех ШК');
  expect(html).toContain('официальные стикеры отправления Ozon');
});
