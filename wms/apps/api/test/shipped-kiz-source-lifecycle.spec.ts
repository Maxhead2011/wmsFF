import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureShippedKizHistory } from '../src/common/shipment-history/shipped-kiz-history';

afterEach(() => vi.unstubAllEnvs());
const pickedAt = new Date('2026-09-05T10:00:00Z');
const shippedAt = new Date('2026-09-05T11:00:00Z');

// TEST: stateful predicate mock exercises the real capture function, including retry protection.
function matches(row: any, where: any): boolean {
  if (where.OR && !where.OR.some((w: any) => matches(row, w))) return false;
  if (where.AND && !where.AND.every((w: any) => matches(row, w))) return false;
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR' || key === 'AND') return true;
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return (!value.in || value.in.includes(row[key])) &&
        (!('not' in value) || row[key] !== value.not) &&
        (!value.lte || row[key] <= value.lte);
    }
    return row[key] === value;
  });
}

function fixture() {
  vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'true');
  vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', 'false');
  const mark: any = { clientId: 'client', skuId: 'sku', value: 'KIZ', status: 'PACKING',
    boxId: 'source', updatedAt: pickedAt, createdAt: pickedAt, sourceDocument: 'receipt' };
  const request: any = { id: 'request', number: 1, title: 'Shipment', status: 'PACKED',
    clientId: 'client', warehouseId: 'wh', client: { name: 'Client' }, updatedAt: shippedAt };
  const history: any[] = [];
  const assembly = { id: 'assembly', orderId: 'order', supplyId: 'supply', skuId: 'sku', kiz: 'KIZ',
    boxId: 'source', boxCode: 'FFL_LKBBOX_014', completedAt: pickedAt };
  const tx = {
    clientRequest: { findUnique: vi.fn(async () => request) },
    fbsTsdAssembly: { findMany: vi.fn(async () => [assembly]) },
    stockMovement: { findMany: vi.fn(async () => []) },
    sku: { findMany: vi.fn(async () => [{ id: 'sku', internalSku: 'SKU', article: 'A', name: 'Suit', color: '', size: '', barcodes: [] }]) },
    productMark: { findMany: vi.fn(async () => [mark]), updateMany: vi.fn(async ({ where, data }: any) => {
      if (!matches(mark, where)) return { count: 0 };
      Object.assign(mark, data, { updatedAt: shippedAt });
      return { count: 1 };
    }) },
    shippedKizHistory: { createMany: vi.fn(async ({ data }: any) => {
      if (history.length) return { count: 0 };
      history.push(...data); return { count: data.length };
    }) },
  };
  return { tx, mark, request, history, assembly };
}

describe('shipped KIZ leaves active source storage', () => {
  it.each(['source', null])('archives a picked KIZ from %s with immutable source history', async boxId => {
    const f = fixture(); f.mark.boxId = boxId;
    await captureShippedKizHistory(f.tx as never, 'request', shippedAt);
    expect(f.mark).toMatchObject({ status: 'SHIPPING', boxId: null });
    expect(f.history).toEqual([expect.objectContaining({ kiz: 'KIZ', sourceBoxCode: 'FFL_LKBBOX_014' })]);
    await captureShippedKizHistory(f.tx as never, 'request', shippedAt);
    expect(f.history).toHaveLength(1);
  });
  it.each(['another box', 'new receipt in same box', 'another sku', 'blocked'])('does not seize %s', async reason => {
    const f = fixture();
    if (reason === 'another box') f.mark.boxId = 'target';
    if (reason === 'new receipt in same box') { f.mark.status = 'AVAILABLE'; f.mark.updatedAt = new Date('2026-09-05T10:30:00Z'); }
    if (reason === 'another sku') f.mark.skuId = 'other';
    if (reason === 'blocked') f.mark.status = 'BLOCKED';
    const before = { ...f.mark };
    await captureShippedKizHistory(f.tx as never, 'request', shippedAt);
    expect(f.mark).toEqual(before);
  });
  it('history refresh of a DONE request cannot mutate current marks', async () => {
    const f = fixture(); f.request.status = 'DONE'; f.mark.status = 'AVAILABLE';
    await captureShippedKizHistory(f.tx as never, 'request', shippedAt);
    expect(f.tx.productMark.updateMany).not.toHaveBeenCalled();
    expect(f.history).toHaveLength(1);
  });
  it('retains the old behavior with the lifecycle flag disabled', async () => {
    const f = fixture(); vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'false');
    await captureShippedKizHistory(f.tx as never, 'request', shippedAt);
    expect(f.mark).toMatchObject({ status: 'SHIPPING', boxId: 'source' });
  });
});
