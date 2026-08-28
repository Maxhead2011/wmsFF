import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  buildFbsCancelledReportXlsx,
  type FbsCancelledExportOrder,
} from '../src/modules/marketplace-connections/fbs-cancelled-report-xlsx';

function cancelledOrder(
  overrides: Partial<FbsCancelledExportOrder> = {},
): FbsCancelledExportOrder {
  return {
    id: '05508811674',
    orderUid: '00000000000000000001',
    accountName: 'WB Москва',
    marketplace: 'WILDBERRIES',
    category: 'cancelled',
    supplierStatus: 'cancel',
    wbStatus: 'canceled_by_client',
    statusLabel: 'Отменён покупателем',
    article: '000123456789012345',
    barcodes: ['04680992593139'],
    itemCount: 1,
    product: {
      name: 'Костюм',
      internalSku: '000123456789012345',
      clientSku: null,
      article: null,
      size: 'L / 46',
    },
    createdAt: '2026-08-27T08:15:00.000Z',
    sellerDate: null,
    supplyId: 'WB-GI-000267374795',
    warehouseId: '507',
    warehouseName: 'Коледино',
    comment: 'Отмена получена из WB',
    request: { number: 382, status: 'IN_WORK' },
    ...overrides,
  };
}

describe('FBS cancelled-orders Excel', () => {
  // TEST: the cancelled-orders report must be a real XLSX with one row per current order.
  it('writes the cancelled order fields without inventing a cancellation timestamp', () => {
    const buffer = buildFbsCancelledReportXlsx([
      cancelledOrder(),
      cancelledOrder({ id: '5508873297', orderUid: 'uid-2' }),
    ]);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets['Отменённые заказы']!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      'Заказ': '05508811674',
      'Причина отмены': 'Отменён покупателем',
      'Заявка WMS': '000382',
      'Поставка': 'WB-GI-000267374795',
    });
    expect(rows[0]?.['Дата заказа']).toEqual(new Date('2026-08-27T08:15:00.000Z'));
    expect(rows[0]).not.toHaveProperty('Дата отмены');
    expect(sheet['!autofilter']?.ref).toBe('A1:R3');
  });

  // TEST: Excel must not round long numeric-looking marketplace identifiers.
  it('stores identifiers as text and preserves leading zeroes', () => {
    const workbook = XLSX.read(buildFbsCancelledReportXlsx([cancelledOrder()]), {
      type: 'buffer',
      cellDates: true,
    });
    const sheet = workbook.Sheets['Отменённые заказы']!;

    expect(sheet.C2).toMatchObject({ t: 's', v: '05508811674' });
    expect(sheet.D2).toMatchObject({ t: 's', v: '00000000000000000001' });
    expect(sheet.H2).toMatchObject({ t: 's', v: '000382' });
    expect(sheet.J2).toMatchObject({ t: 's', v: 'WB-GI-000267374795' });
    expect(sheet.N2).toMatchObject({ t: 's', v: '000123456789012345' });
    expect(sheet.P2).toMatchObject({ t: 's', v: '04680992593139' });
  });

  // TEST: an invalid marketplace creation date stays blank instead of creating a false date.
  it('keeps an invalid order timestamp blank', () => {
    const workbook = XLSX.read(
      buildFbsCancelledReportXlsx([cancelledOrder({ createdAt: 'invalid', sellerDate: null })]),
      { type: 'buffer', cellDates: true },
    );
    const sheet = workbook.Sheets['Отменённые заказы']!;

    expect(sheet.E2).toBeUndefined();
  });
});
