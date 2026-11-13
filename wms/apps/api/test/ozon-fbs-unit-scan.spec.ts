import { describe, expect, it } from 'vitest';
import * as scans from '../src/modules/marketplace-connections/ozon-fbs-pick-lines';
import { ozonMarkedUnits } from '../src/common/ozon-unit-marks';

const kiz = '0104610460840526215OdGM-';
const state = (): any => ({ version: 1, unitMarksVersion: 1, submission: 'PICKING', legacyScansDiscarded: false,
  source: { boxId: 'box', boxCode: 'BOX' }, lines: [
    { productId: 1, offerId: 'a', skuId: 'a', requestItemId: 'a', quantity: 1, article: 'a', name: 'a', barcodes: ['1234567890123'], requiresKiz: true, picks: [] },
    { productId: 2, offerId: 'b', skuId: 'b', requestItemId: 'b', quantity: 1, article: 'b', name: 'b', barcodes: ['1234567890124'], requiresKiz: false, picks: [] },
  ] });
const task = { id: 'task', marketplace: 'OZON', itemCount: 2, kiz: null };

describe('normal marked multiline Ozon scanning', () => {
  // TEST: a product barcode must not count as a picked marked unit.
  it('waits for KIZ, persists pending barcode and accepts a retry only once', () => {
    const pending = scans.recordOzonLineScan(state(), '1234567890123', 0, 'picker');
    expect(scans.ozonPickCount(pending)).toBe(0);
    expect(pending).toMatchObject({ pendingBarcode: '1234567890123' });
    const accepted = (scans as any).recordOzonUnitKiz(pending, kiz, 0, 'picker');
    expect(scans.ozonPickCount(accepted)).toBe(1);
    expect((scans as any).recordOzonUnitKiz(accepted, kiz, 0, 'picker')).toBe(accepted);
    expect(() => (scans as any).recordOzonUnitKiz(accepted, '0104610460840540215K.W,b', 0, 'picker')).toThrow();
    expect(() => (scans as any).recordOzonUnitKiz(state(), kiz, 0, 'picker')).toThrow();
  });
  // TEST: global duplicate checks must see already picked units before the order is complete.
  it('exposes partial claims, but still rejects an incomplete completed order', () => {
    const partial = state(); partial.lines[0].picks = [{ kiz, barcode: '1234567890123', boxId: 'box' }];
    expect(ozonMarkedUnits(task, partial)).toHaveLength(1);
    // TEST: shipment validation must reject a still-picking partial ledger.
    expect(() => (ozonMarkedUnits as any)(task, partial, { requireComplete: true })).toThrow();
    partial.submission = 'COMPLETED';
    expect(() => ozonMarkedUnits(task, partial)).toThrow();
  });
  // TEST: unmarked goods in a mixed order require their barcode, not a fabricated KIZ.
  it('materializes only marked units of a complete mixed order', () => {
    const complete = state(); complete.submission = 'COMPLETED';
    complete.lines[0].picks = [{ kiz, barcode: '1234567890123', boxId: 'box' }];
    complete.lines[1].picks = [{ barcode: '1234567890124', boxId: 'box' }];
    expect(ozonMarkedUnits(task, complete)).toHaveLength(1);
    complete.lines[0].picks[0].kiz = '';
    expect(() => ozonMarkedUnits(task, complete)).toThrow();
  });
});
