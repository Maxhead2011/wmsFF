import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { pendingScannedReviewIds } from '../src/modules/inventory/pending-kiz-review';
const start = new Date('2026-09-18T10:00:00Z');
function fixture(count = 1200) {
 const boxes = Array.from({ length: count }, (_, i) => ({ id: `audit-${i}`, boxId: `box-${i}`, startedAt: start, status: 'MATCHED' }));
 const session = { id: 'session', clientId: 'client', boxes };
 const db = {
  inventorySession: { findMany: vi.fn(async () => [session]) },
  inventoryAuditBox: { findMany: vi.fn(async ({ where }) => boxes.filter(b => where.boxId.in.includes(b.boxId))), findFirst: vi.fn(async ({where}) => boxes.find(b=>b.boxId===where.boxId)) },
  auditLog: { findUnique: vi.fn(async()=>null), findMany: vi.fn(async ({ where }) => where.id ? [] : (typeof where.entityId==='string' ? [{id:'scan'}] : where.entityId.in.map((id:string)=>({entityId:id,createdAt:start})))) },
 };
 return { db, boxes, session };
}
afterEach(()=>vi.unstubAllEnvs());
describe('batched pending inventory KIZ reviews',()=>{
 // TEST: exercise the real review entry point; 1,200 boxes must not cause thousands of serial queries.
 it('lists the same saved boxes using nine bounded reads and no per-box queries',async()=>{
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT','true');vi.stubEnv('WMS_INVENTORY_ADMIN_KIZ_RECONCILE_ENABLED','true');vi.stubEnv('WMS_INVENTORY_REVIEW_BATCH_ENABLED','true');
  const f=fixture();const service=new InventoryService(f.db as never,{} as never,{} as never);
  const result=await (service as any).pendingKizReviews({id:'admin',roleCodes:['ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL'},null);
  expect(result[0].boxes).toHaveLength(1200);
  expect(f.db.inventoryAuditBox.findFirst).not.toHaveBeenCalled();expect(f.db.auditLog.findUnique).not.toHaveBeenCalled();
  expect(f.db.inventoryAuditBox.findMany).toHaveBeenCalledTimes(3);expect(f.db.auditLog.findMany).toHaveBeenCalledTimes(6);
 });
 it('keeps current-round evidence, latest-check ordering and completed confirmations separate',async()=>{
  const f=fixture(4);f.boxes[1].startedAt=new Date('2026-09-18T12:00:00Z');
  f.db.inventoryAuditBox.findMany.mockResolvedValue([f.boxes[0],f.boxes[1],{...f.boxes[2],id:'newer'},f.boxes[3]]);
  f.db.auditLog.findMany.mockImplementation(async({where}:any)=>where.id?[{id:`inventory-kiz-confirm:audit-3:${start.toISOString()}`}] as any:[{entityId:'audit-0',createdAt:start},{entityId:'audit-1',createdAt:start}] as any);
  expect([...await pendingScannedReviewIds(f.db as never,f.boxes)]).toEqual(['audit-0']);
  expect(f.db.inventoryAuditBox.findMany.mock.calls[0][0]).toMatchObject({orderBy:[{startedAt:'desc'},{id:'desc'}],distinct:['boxId']});
 });
 it('does not query inaccessible sessions or write inventory',async()=>{
  vi.stubEnv('WMS_FBS_KIZ_MANDATORY_AUDIT','true');vi.stubEnv('WMS_INVENTORY_ADMIN_KIZ_RECONCILE_ENABLED','true');vi.stubEnv('WMS_INVENTORY_REVIEW_BATCH_ENABLED','true');
  const f=fixture();const service=new InventoryService(f.db as never,{} as never,{} as never);
  expect(await (service as any).pendingKizReviews({roleCodes:['ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL',hiddenClientIds:['client']},null)).toEqual([]);
  expect(f.db.inventoryAuditBox.findMany).not.toHaveBeenCalled();expect(f.db.auditLog.findMany).not.toHaveBeenCalled();
 });
 it('ignores a round restarted while the dashboard was loading',async()=>{
  const f=fixture(1);f.db.inventoryAuditBox.findMany.mockResolvedValue([{...f.boxes[0],startedAt:new Date(start.getTime()+1000)}]);
  expect([...await pendingScannedReviewIds(f.db as never,f.boxes)]).toEqual([]);expect(f.db.auditLog.findMany).not.toHaveBeenCalled();
 });
 it('propagates database errors rather than hiding reviews',async()=>{const f=fixture(1);f.db.auditLog.findMany.mockRejectedValue(new Error('db down'));await expect(pendingScannedReviewIds(f.db as never,f.boxes)).rejects.toThrow('db down');});
});
