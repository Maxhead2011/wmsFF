import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FbsReturnReceiptDialog, receiptScansReady } from './FbsReturnReceiptDialog';

describe('physical FBS return receipt form', () => {
  // TEST: no old box/KIZ is prefilled as fake scan evidence.
  it('renders empty required scans, an explicit receipt action and a cancel action', () => {
    const html = renderToStaticMarkup(createElement(FbsReturnReceiptDialog, {
      orderId: '5426435634', productName: 'Костюм', requiresKiz: true,
      busy: false, onSubmit: vi.fn(), onClose: vi.fn(),
    }));
    expect(html).toContain('Повторная приёмка');
    for (const name of ['returnBoxCode', 'returnBarcode', 'returnKiz']) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('Принять в бокс'); expect(html).toContain('Отмена');
    expect(html).not.toContain('value="5426435634"');
  });
  it.each([
    [{ returnBoxCode: '', returnBarcode: '001', returnKiz: 'KIZ' }, true, false],
    [{ returnBoxCode: 'BOX', returnBarcode: ' ', returnKiz: 'KIZ' }, true, false],
    [{ returnBoxCode: 'BOX', returnBarcode: '001', returnKiz: '' }, true, false],
    [{ returnBoxCode: 'BOX', returnBarcode: '001', returnKiz: 'KIZ' }, true, true],
    [{ returnBoxCode: 'BOX', returnBarcode: '001', returnKiz: '' }, false, true],
  ])('requires physical scans before submission', (scans, marked, ready) => {
    expect(receiptScansReady(scans, marked)).toBe(ready);
  });
});
