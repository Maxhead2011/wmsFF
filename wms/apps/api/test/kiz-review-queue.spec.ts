import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {reviewContext, permittedReviewAction, requireReviewAdmin,assertUnusedReplacement} from '../src/common/kiz-review-queue';
// TEST: released codes and retired codes never share an administrator permission.
it('separates reuse from relabel and requires a matching task context',()=>{
  const row={context:'same',status:'APPROVED',resolution:'REUSE'};
  expect(permittedReviewAction(row,'same','REVIEW')).toBe('ALLOW');
  expect(permittedReviewAction(row,'same','RELABEL')).toBeNull();
  expect(permittedReviewAction(row,'changed','REVIEW')).toBeNull();
  expect(permittedReviewAction({...row,resolution:'RELABEL'},'same','RELABEL')).toBe('RELABEL');
  expect(permittedReviewAction({...row,resolution:'RELABEL'},'same','REVIEW')).toBeNull();
});
it('binds a decision to one task attempt, unit route and order',()=>{
  const task={id:'t',clientId:'c',connectionId:'conn',requestId:'r',orderId:'1',skuId:'s',boxId:'b',workerUserId:'w',startedAt:new Date(0),createdAt:new Date(0)};
  for(const changed of [{id:'next'},{boxId:'other'},{skuId:'other'},{orderId:'2'},{startedAt:new Date(1)}])
    expect(reviewContext({...task,...changed} as any)).not.toBe(reviewContext(task as any));
});
beforeEach(()=>{vi.stubEnv('WMS_KIZ_REVIEW_QUEUE_ENABLED','true');vi.stubEnv('WMS_KIZ_REUSE_EVIDENCE_ENABLED','true');});
afterEach(()=>vi.unstubAllEnvs());
it('denies pickers, demo accounts and inaccessible warehouses before reading',()=>{
  const admin={roleCodes:['ADMIN'],permissionCodes:[],activeWarehouseId:'wh',warehouseIds:['wh']};
  expect(()=>requireReviewAdmin(admin as any)).not.toThrow();
  for(const change of [{roleCodes:['OPERATOR']},{isDemo:true},{warehouseIds:['other']},{activeWarehouseId:null}])
    expect(()=>requireReviewAdmin({...admin,...change} as any)).toThrow();
  vi.stubEnv('WMS_KIZ_REVIEW_QUEUE_ENABLED','false');expect(()=>requireReviewAdmin(admin as any)).toThrow();
});
// TEST: scanner formatting or a changed signature never bypasses the replacement serial check.
it('rejects a registered new serial with a different cryptographic suffix',async()=>{
  const identity='0104680992590022215MywwfMmgS<1E';
  const tx:any={$queryRaw:vi.fn(async()=>[]),productMark:{findMany:vi.fn(async()=>[{value:identity+'\u001d91EE12\u001d92OLD'}])},
    fbsTsdAssembly:{findMany:vi.fn(async()=>[])},shippedKizHistory:{findMany:vi.fn(async()=>[])}};
  await expect(assertUnusedReplacement(tx,']d2'+identity+'\u001d91EE12\u001d92NEW')).rejects.toThrow('уже зарегистрирован');
});
