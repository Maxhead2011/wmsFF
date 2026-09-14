import { describe, expect, it } from 'vitest';
import { buildInvoiceRows } from './BillingInvoiceForm';

describe('Lukin invoice service label', () => {
  // TEST: the catalogue name must not disguise the single agreed primary-processing line.
  it.each([true, false])('shows the scoped service name only for policy invoices: %s', scoped => {
    const invoice: any = { items: [{ id: 'item', description: 'Первичная обработка', quantity: 12,
      unit: 'PIECE', unitPriceRub: '10.64', serviceDate: '2026-09-14', charge: { serviceId: 'service',
        metadata: { kind: 'FBS_PRIMARY_PROCESSING', serviceCode: 'ITEM_PROCESSING',
          billingPolicy: scoped ? 'LUKIN_PRIMARY_V1' : undefined, taxMode: 'INCLUDED', priceBeforeTaxRub: 10.64 } } }] };
    const services: any = [{ service: { id: 'service', code: 'ITEM_PROCESSING', name: 'Обработка товара' } }];
    const [row] = buildInvoiceRows(invoice, services);
    expect(row.serviceSearch).toBe(scoped ? 'Первичная обработка' : 'Обработка товара');
    expect(row).toMatchObject({ serviceId: 'service', quantity: '12', unitPriceRub: '10.64', taxMode: 'INCLUDED' });
  });
});
