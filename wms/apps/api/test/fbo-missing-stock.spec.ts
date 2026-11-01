import {afterEach,expect,it,vi} from 'vitest';
import {missingStockHolds} from '../src/common/stock/fbo-missing-stock';
afterEach(()=>vi.unstubAllEnvs());
it('withholds only the reported quantity until a later verified count of that box',async()=>{
  // TEST: unrelated boxes and earlier recounts cannot release a missing unit.
  vi.stubEnv('WMS_FBO_EXCEL_PICK_CHECK_ENABLED','true');
  const start=new Date();
  const verified=vi.fn().mockResolvedValue([]);
  const db={auditLog:{findMany:vi.fn().mockResolvedValue([{createdAt:start,payload:{boxId:'box',skuId:'sku',quantity:2}}])},inventoryAuditBox:{findMany:verified}};
  const read=()=>missingStockHolds(db as never,'client','warehouse',['sku']);
  expect((await read()).get('box')?.get('sku')).toBe(2);
  verified.mockResolvedValue([{boxId:'other',startedAt:start},{boxId:'box',startedAt:new Date(start.getTime()-1000)}]);
  expect((await read()).get('box')?.get('sku')).toBe(2);
  verified.mockResolvedValue([{boxId:'box',startedAt:new Date(start.getTime()+1000)}]);expect((await read()).size).toBe(0);
});
