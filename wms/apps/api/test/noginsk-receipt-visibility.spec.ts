import { afterEach, expect, it, vi } from 'vitest';
import { WarehouseService } from '../src/modules/warehouse/warehouse.service';
afterEach(() => vi.unstubAllEnvs());
function setup() {
  const boxes = [{ id: 'old', code: 'FFL_NLKB0109_10', status: 'receiving', balances: [], productMarks: [] },
    { id: 'new', code: 'FFL_NLKB0209_40', status: 'receiving', balances: [], productMarks: [] }];
  const operations = boxes.map((b, i) => ({ id: b.id, operationType: 'receipt_open_box', deviceId: '',
    createdAt: new Date(i ? '2026-09-04T08:00:00Z' : '2026-09-01T08:00:00Z'),
    payload: { clientId: 'lukin-short', warehouseId: 'noginsk', boxCode: b.code, sourceDocument: 'TSD-RECEIPT-' + b.id } })).reverse();
  const db = { client: { findUnique: vi.fn().mockResolvedValue({ id: 'lukin-short' }) },
    tsdOperation: { findMany: vi.fn().mockResolvedValue(operations) },
    box: { findMany: vi.fn().mockResolvedValue(boxes) }, stockMovement: { findMany: vi.fn().mockResolvedValue([]) } };
  const service = new WarehouseService(db as never, { requireClientAccess: vi.fn() } as never,
    null as never, null as never, null as never, null as never, { getPolicy: async () => ({ receiptPrefix: 'FFL_LKB' }) } as never);
  const user = { roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], activeWarehouseId: 'noginsk' } as never;
  return { service, db, user };
}
// TEST: an older still-open Noginsk receipt must not vanish behind a newer batch.
it('keeps older open boxes with the WMSFF2207 flag', async () => {
  vi.stubEnv('WMS_NOGINSK_RECEIPT_SCOPE_FIX_ENABLED', 'true');
  const {service,user}=setup();const result=await service.listOnlineReceipts({clientId:'lukin-short'},user);
  expect(result.boxes.map(b=>b.boxCode)).toContain('FFL_NLKB0109_10');expect(result.boxes).toHaveLength(2);
});
// TEST: sold installations retain the existing latest-batch behavior.
it('leaves the disabled path unchanged', async () => {
  vi.stubEnv('WMS_NOGINSK_RECEIPT_SCOPE_FIX_ENABLED', 'false');
  const {service,user}=setup();expect((await service.listOnlineReceipts({clientId:'lukin-short'},user)).boxes).toHaveLength(1);
});
// TEST: receipt documents work independently of a Moscow-specific box prefix, with both scopes retained.
it('includes branch receipt documents without losing client/warehouse filters', async () => {
  vi.stubEnv('WMS_NOGINSK_RECEIPT_SCOPE_FIX_ENABLED', 'true');
  const {service,db,user}=setup();await service.listReceiptBatches({clientId:'lukin-short'},user);
  expect(db.stockMovement.findMany.mock.calls[0][0].where).toMatchObject({clientId:'lukin-short',warehouseId:'noginsk',
    OR:[{box:{code:{startsWith:'FFL_LKB'}}},{sourceDocument:{startsWith:'TSD-RECEIPT-'}}]});
});
// TEST: a branch-scoped read of receipt events must not fetch Moscow events.
it('keeps event scope restricted to selected client and warehouse', async()=>{
  vi.stubEnv('WMS_NOGINSK_RECEIPT_SCOPE_FIX_ENABLED','true');const {service,db,user}=setup();
  await service.listOnlineReceipts({clientId:'lukin-short'},user);
  expect(db.tsdOperation.findMany.mock.calls[0][0].where.AND).toEqual([
    {payload:{path:['clientId'],equals:'lukin-short'}},{payload:{path:['warehouseId'],equals:'noginsk'}}]);
});
