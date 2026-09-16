import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BillingInvoiceServiceSummary, summarizeInvoiceItems } from './BillingInvoiceServiceSummary';

const item = { id: 'one', description: 'Обработка товара', unit: 'PIECE', quantity: '0.333', unitPriceRub: '1.00', totalRub: '0.33', serviceDate: '2026-08-01T00:00:00Z' } as any;
describe('invoice service summary', () => {
  // TEST: do not recalculate rounded amounts or change source items/IDs used by the editor.
  it('sums identical services across dates and preserves originals', () => {
    const items = [item, { ...item, id: 'two', description: ' обработка   товара ', serviceDate: '2026-08-31T00:00:00Z' }];
    const before = structuredClone(items);
    expect(summarizeInvoiceItems(items)).toEqual([expect.objectContaining({ quantity: 0.666, totalRub: 0.66, unitPriceRub: 1, dateFrom: item.serviceDate, dateTo: items[1].serviceDate })]);
    expect(items).toEqual(before);
  });
  it('keeps different tariffs and units separate, including free services', () => {
    expect(summarizeInvoiceItems([item, { ...item, unitPriceRub: '2' }, { ...item, unit: 'BOX' }, { ...item, description: 'Бесплатно', totalRub: '0' }])).toHaveLength(4);
  });
  it('renders one row for equal services with date range and no editing controls', () => {
    const html = renderToStaticMarkup(<BillingInvoiceServiceSummary items={[item, { ...item, id: 'two', serviceDate: '2026-08-31T00:00:00Z' }]} />);
    expect(html.match(/Обработка товара/g)).toHaveLength(1);
    expect(html).toContain('01.08.2026'); expect(html).toContain('31.08.2026');
    expect(html).not.toContain('<input');
  });
});
