import { afterEach, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DuplicateStockGroupsService } from '../src/modules/marketplace-connections/duplicate-stock-groups.service';

function fixture() {
  for (const flag of ['WMS_DUPLICATE_APPLY_QUEUE_ENABLED','WMS_DUPLICATE_STOCK_SELF_SERVICE_ENABLED','WMS_DUPLICATE_STOCK_PUBLICATION_ENABLED','WMS_WB_URGENT_STOCK_SYNC']) vi.stubEnv(flag,'true');
  const db:any={systemSetting:{findUnique:vi.fn(async()=>null),findMany:vi.fn(async()=>[]),upsert:vi.fn(async({create})=>create)},auditLog:{create:vi.fn()},$executeRaw:vi.fn(),$queryRaw:vi.fn(async()=>[{acquired:true}])};
  db.$transaction=vi.fn(async(fn)=>fn(db));
  const service:any=new DuplicateStockGroupsService(db,{} as any,{} as any);
  vi.spyOn(service,'authorize').mockReturnValue(undefined);
  vi.spyOn(service,'preview').mockResolvedValue({previewKey:'p'});
  vi.spyOn(service,'validate').mockResolvedValue({});
  vi.spyOn(service,'read').mockResolvedValue({});
  const body:any={group:{id:'g',name:'Группа'},revision:null,previewKey:'p',confirmationKey:'reviewed-confirmation'};
  const user:any={id:'u'};
  return {db,service,body,user};
}
afterEach(()=>vi.unstubAllEnvs());

// TEST: approved production integration retains the live confirmation key before durable acceptance.
it('passes explicit confirmation through preview, validation and persisted request',async()=>{
  const f=fixture();const result=await f.service.apply('c',f.body,f.user);
  expect(result.applyRequest.status).toBe('WAITING');
  expect(f.service.preview).toHaveBeenCalledWith('c',{group:f.body.group,confirmationKey:'reviewed-confirmation'},f.user);
  expect(f.service.validate).toHaveBeenCalledWith('c',f.body.group,f.user,f.db,true,'reviewed-confirmation');
  expect(f.db.systemSetting.upsert.mock.calls[0][0].create.value.body.confirmationKey).toBe('reviewed-confirmation');
});
it('does not queue an unconfirmed relabel change',async()=>{
  const f=fixture();f.service.validate.mockRejectedValue(new ConflictException('Confirmation required'));
  await expect(f.service.apply('c',f.body,f.user)).rejects.toThrow('Confirmation required');
  expect(f.db.systemSetting.upsert).not.toHaveBeenCalled();
});
it('revalidates confirmation after obtaining the publisher lock',async()=>{
  const f=fixture();
  f.body.group={id:'g',name:'Group',connectionId:'wb',reserve:{mode:'COMMON',value:0},shares:[{targetKey:'original',label:'Source',percent:50},{targetKey:'duplicate',label:'Target',percent:50}],variants:[{sourceSkuId:'s',targets:[{targetKey:'original',targetId:'s',confirmed:true,requiresRelabel:false},{targetKey:'duplicate',targetId:'t',confirmed:true,requiresRelabel:true}]}],overrides:[]};
  f.service.validate.mockRejectedValue(new ConflictException('Confirmation expired'));
  await expect(f.service.applyNow('c',f.body,f.user,'queued-request')).rejects.toThrow('Confirmation expired');
  expect(f.service.validate).toHaveBeenCalledWith('c',f.body.group,f.user,f.db,true,'reviewed-confirmation');
  expect(f.db.$executeRaw).toHaveBeenCalledTimes(2);
  expect(f.db.systemSetting.upsert).not.toHaveBeenCalled();
});
