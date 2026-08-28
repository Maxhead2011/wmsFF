import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  buildFbsDeadlineReportXlsx,
  type FbsDeadlineExportOrder,
} from '../src/modules/marketplace-connections/fbs-deadline-report-xlsx';

function order(overrides: Partial<FbsDeadlineExportOrder> = {}): FbsDeadlineExportOrder {
  return {
    id: '05508811674',
    orderUid: '00000000000000000001',
    accountName: 'WB Москва',
    supplierStatus: 'confirm',
    wbStatus: 'waiting',
    statusLabel: 'На сборке',
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
    storageBoxes: [{ code: 'FFL_LKB1007_122', quantity: 3, status: 'AVAILABLE' }],
    createdAt: '2026-08-27T00:00:00.000Z',
    sellerDate: null,
    supplyId: 'WB-GI-000267374795',
    warehouseId: '507',
    warehouseName: 'Коледино',
    comment: null,
    request: { number: 382, status: 'IN_WORK' },
    reservation: { status: 'RESERVED', palletCode: 'PALET_SORT_079', problem: null },
    shipmentPlan: { requiresCargoPlaces: true, cargoPlaceCount: 2 },
    ...overrides,
  };
}

describe('FBS deadline selected-order Excel', () => {
  // TEST: the export is a real XLSX and contains exactly the orders passed after server-side selection.
  it('writes one data row per selected order', () => {
    const buffer = buildFbsDeadlineReportXlsx(
      [order(), order({ id: '5508873297', orderUid: 'uid-2' })],
      true,
      Date.parse('2026-08-28T00:00:00.000Z'),
    );
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets['Заказы FBS']!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row['Заказ WB'])).toEqual(['05508811674', '5508873297']);
    expect(sheet['!autofilter']?.ref).toBe('A1:X3');
  });

  // TEST: numeric-looking identifiers remain text and keep leading zeroes.
  it('stores WB IDs, articles, barcodes and supply IDs as text', () => {
    const workbook = XLSX.read(
      buildFbsDeadlineReportXlsx([order()], true, Date.parse('2026-08-28T00:00:00.000Z')),
      { type: 'buffer', cellDates: true },
    );
    const sheet = workbook.Sheets['Заказы FBS']!;

    expect(sheet.B2).toMatchObject({ t: 's', v: '05508811674' });
    expect(sheet.C2).toMatchObject({ t: 's', v: '00000000000000000001' });
    expect(sheet.K2).toMatchObject({ t: 's', v: '000123456789012345' });
    expect(sheet.M2).toMatchObject({ t: 's', v: '04680992593139' });
    expect(sheet.U2).toMatchObject({ t: 's', v: 'WB-GI-000267374795' });
  });

  // TEST: WAITING_STOCK overrides stale positive box rows exactly as on the report screen.
  it('does not export stale availability for WAITING_STOCK', () => {
    const workbook = XLSX.read(
      buildFbsDeadlineReportXlsx([
        order({ reservation: { status: 'WAITING_STOCK', palletCode: null, problem: 'Нет товара' } }),
      ], true),
      { type: 'buffer' },
    );
    const sheet = workbook.Sheets['Заказы FBS']!;

    expect(sheet.O2.v).toBe('Нет на складе');
    expect(sheet.P2.v).toBe(0);
  });
});
