import { afterEach, expect, it, vi } from 'vitest';
import { WarehouseService } from '../src/modules/warehouse/warehouse.service';
afterEach(()=>vi.unstubAllEnvs());
// TEST: ten actual receipts (75 units) must join the original party; packaging without RECEIPT is never selected.
it.each([true,false])('groups FBO-prefixed receipts in the list with flag %s',async enabled=>{
  vi.stubEnv('WMS_RECEIPT_FBO_BATCH_DATE_ENABLED',String(enabled));
  const movements=[{quantity:4054,createdAt:new Date('2026-09-24T12:00:00Z'),box:{code:'FFL_LKB2409_1'},_count:{productMarks:4053}},
    ...Array.from({length:10},(_,i)=>({quantity:i<5?8:7,createdAt:new Date('2026-09-25T12:00:00Z'),box:{code:`FFL_LKBFBO2409_${250+i}`},_count:{productMarks:i<5?8:7}}))];
  const service=Object.create(WarehouseService.prototype) as any;
  service.prisma={stockMovement:{findMany:vi.fn(async()=>movements)}};
  service.clientScopes={requireClientAccess:vi.fn()};service.resolveReadWarehouseId=()=> 'warehouse';
  service.boxCodes={getPolicy:async()=>({receiptPrefix:'FFL_LKB'})};
  const result=await service.listReceiptBatches({clientId:'client'},{});
  expect(service.prisma.stockMovement.findMany.mock.calls[0][0].where).toMatchObject({clientId:'client',warehouseId:'warehouse',type:'RECEIPT',quantity:{gt:0}});
  const batch=result.find((b:any)=>b.date==='2026-09-24');
  expect(batch.quantity).toBe(enabled?4129:4054);
  expect(batch.boxes).toBe(enabled?11:1);
  expect(batch.boxCodes.includes('FFL_LKBFBO2409_250')).toBe(enabled);
});
