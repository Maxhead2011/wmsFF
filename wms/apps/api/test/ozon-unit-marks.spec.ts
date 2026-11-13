import { describe, expect, it } from 'vitest';
import { ozonMarkedUnits } from '../src/common/ozon-unit-marks';

// TEST: the second product must retain its own SKU and KIZ in checks and shipment history.
const task = { id: 'task', marketplace: 'OZON', itemCount: 2, skuId: 'small', kiz: null };
const small = '0104610460840526215OdGM-';
const large = '0104610460840540215K.W,b';
const state = () => ({ version: 1, unitMarksVersion: 1, submission: 'COMPLETED', lines: [
  { productId: 1, skuId: 'small', requestItemId: 'a', quantity: 1, picks: [{ kiz: small, boxId: null, boxCode: 'БЕЗ КОРОБА' }] },
  { productId: 2, skuId: 'large', requestItemId: 'b', quantity: 1, picks: [{ kiz: large, boxId: null, boxCode: 'БЕЗ КОРОБА' }] },
] });
describe('per-unit Ozon marking evidence', () => {
  it('expands one task into two distinct identities without changing the order', () => {
    expect(ozonMarkedUnits(task, state())).toMatchObject([
      { id: 'task:ozon:1:0', taskId: 'task', skuId: 'small', kiz: small },
      { id: 'task:ozon:2:0', taskId: 'task', skuId: 'large', kiz: large },
    ]);
  });
  it('keeps old single-code tasks unchanged', () => {
    expect(ozonMarkedUnits({ ...task, kiz: small }, null)).toEqual([{ ...task, kiz: small }]);
    expect(ozonMarkedUnits(task, null)).toEqual([]);
  });
  it('rejects missing codes, duplicate identities and incomplete unit counts', () => {
    const missing = state(); missing.lines[1].picks[0].kiz = '';
    expect(() => ozonMarkedUnits(task, missing)).toThrow();
    const duplicate = state(); duplicate.lines[1].picks[0].kiz = small;
    expect(() => ozonMarkedUnits(task, duplicate)).toThrow();
    const incomplete = state(); incomplete.lines[1].picks = [];
    expect(() => ozonMarkedUnits(task, incomplete)).toThrow();
    expect(() => ozonMarkedUnits({ ...task, itemCount: 3 }, state())).toThrow();
  });
  it('does not permit two lines to reuse the same history key', () => {
    const duplicate = state(); duplicate.lines[1].productId = 1;
    expect(() => ozonMarkedUnits(task, duplicate)).toThrow();
  });
});
