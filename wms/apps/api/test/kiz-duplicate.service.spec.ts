import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KizDuplicateService } from '../src/modules/print/kiz-duplicate.service';
import { buildKizDuplicateLabel } from '../src/modules/print/kiz-duplicate-label';
vi.mock('../src/modules/print/kiz-duplicate-label', () => ({ buildKizDuplicateLabel: vi.fn().mockResolvedValue('PNG') }));
const raw='0104680992597663215(bfrY!Bf.IME\u001d91EE12\u001d92AbCd/0123+xyz=';
const user:any={id:'operator',name:'Склад',roleCodes:['OPERATOR'],permissionCodes:['print:write'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[],activeWarehouseId:'moscow'};
const product={id:'sku',name:'Костюм',article:'Корея',size:'L',color:'голубой',barcodes:[{value:'2050000000000'}]};
function fixture(){
 const jobs=new Map<string,any>();
 const db:any={warehouseClient:{findMany:vi.fn().mockResolvedValue([{clientId:'client',client:{name:'Клиент',status:'ACTIVE'}}])},
  $queryRaw:vi.fn().mockResolvedValue([{skuId:'sku'}]),sku:{findMany:vi.fn().mockResolvedValue([product])},
  kizDuplicatePrinter:{findMany:vi.fn().mockResolvedValue([{stationId:'station'}]),findUnique:vi.fn().mockResolvedValue({stationId:'station',warehouseId:'moscow',agentUserId:'operator'})},
  fbsPrintStation:{findMany:vi.fn().mockResolvedValue([{id:'station'}])},auditLog:{create:vi.fn().mockResolvedValue({})},
  kizDuplicateJob:{findUnique:vi.fn(async({where}:any)=>jobs.get(where.id)??null),findUniqueOrThrow:vi.fn(async({where}:any)=>jobs.get(where.id)),
   create:vi.fn(async({data}:any)=>{jobs.set(data.id,{...data,status:'QUEUED'});return jobs.get(data.id)}),
   update:vi.fn(async({where,data}:any)=>{const value={...jobs.get(where.id),...data};jobs.set(where.id,value);return value}),
   updateMany:vi.fn(async({where,data}:any)=>{const value=jobs.get(where.id);if(value?.status!==where.status)return {count:0};jobs.set(where.id,{...value,...data});return {count:1}})},
 };
 db.$transaction=vi.fn(async(fn:any)=>fn(db));
 return {db,jobs,service:new KizDuplicateService(db)};
}
beforeEach(()=>{vi.stubEnv('WMS_KIZ_DUPLICATE_ENABLED','true');vi.clearAllMocks()});
describe('isolated duplicate KIZ workflow',()=>{
 // TEST: no inventory, mark binding or marketplace writer is available in these fixtures.
 it('is disabled by default for the sold VM',async()=>{vi.stubEnv('WMS_KIZ_DUPLICATE_ENABLED','false');const {service,db}=fixture();await expect(service.clients(user)).rejects.toThrow('не включён');expect(db.warehouseClient.findMany).not.toHaveBeenCalled()});
 it('rejects a user without printing permission or a selected warehouse',async()=>{const {service}=fixture();await expect(service.clients({...user,permissionCodes:[]})).rejects.toThrow('Нет права');await expect(service.clients({...user,activeWarehouseId:null})).rejects.toThrow('филиал')});
 it('rejects another client before looking at KIZ data',async()=>{const {service,db}=fixture();await expect(service.lookup({clientId:'other',kiz:raw},user)).rejects.toThrow('Нет доступа');expect(db.$queryRaw).not.toHaveBeenCalled()});
 it('resolves an exact KIZ',async()=>{const {service}=fixture();expect(await service.lookup({clientId:'client',kiz:raw},user)).toMatchObject({state:'READY',match:'EXACT_KIZ',kiz:raw,product})});
 it('asks for barcode instead of selecting one of several GTIN matches',async()=>{const {service,db}=fixture();db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{skuId:'a'},{skuId:'b'}]);expect(await service.lookup({clientId:'client',kiz:raw},user)).toMatchObject({state:'NEED_BARCODE',product:null});expect(db.sku.findMany).not.toHaveBeenCalled()});
 it('unknown KIZ plus barcode supplies the label caption without registering a mark',async()=>{const {service,db}=fixture();db.$queryRaw.mockResolvedValue([]);expect(await service.lookup({clientId:'client',kiz:raw,barcode:'2050000000000'},user)).toMatchObject({state:'READY',match:'BARCODE_CONFIRMED'});expect(db.auditLog.create).not.toHaveBeenCalled()});
 it('refuses a barcode contradicting the known KIZ',async()=>{const {service,db}=fixture();db.$queryRaw.mockResolvedValue([{skuId:'other'}]);await expect(service.lookup({clientId:'client',kiz:raw,barcode:'2050000000000'},user)).rejects.toThrow('другому товару')});
 it('retries the same request without another label or job',async()=>{
  const {service,db}=fixture();const body={id:'11111111-1111-4111-8111-111111111111',clientId:'client',stationId:'station',skuId:'sku',deviceCode:'SOS',kiz:raw};
  expect(await service.create(body,user)).toMatchObject({status:'QUEUED'});expect(await service.create(body,user)).toMatchObject({status:'QUEUED'});
  expect(db.kizDuplicateJob.create).toHaveBeenCalledTimes(1);expect(buildKizDuplicateLabel).toHaveBeenCalledTimes(1);
  await expect(service.create({...body,kiz:raw+'x'},user)).rejects.toThrow('другой печати');
 });
 it('refuses an old/offline print agent',async()=>{const {service,db}=fixture();db.fbsPrintStation.findMany.mockResolvedValue([]);await expect(service.create({id:'11111111-1111-4111-8111-111111111111',clientId:'client',stationId:'station',skuId:'sku',deviceCode:'SOS',kiz:raw},user)).rejects.toThrow('Станция недоступна');expect(db.kizDuplicateJob.create).not.toHaveBeenCalled()});
 it('cannot verify a different full code or another user’s job',async()=>{
  const {service,jobs}=fixture();jobs.set('job',{id:'job',clientId:'client',warehouseId:'moscow',requestedById:'operator',status:'PRINTED',kiz:raw});
  await expect(service.verify('job',raw+'x',user)).rejects.toThrow('не совпадает');await expect(service.status('job',{...user,id:'other'})).rejects.toThrow('не найдено');
  expect(await service.verify('job',raw,user)).toMatchObject({status:'VERIFIED'});
 });
 it('does not automatically reclaim an uncertain physical print',async()=>{
  const {service,db}=fixture();db.$queryRaw.mockResolvedValue([]);expect(await service.claim('station',user)).toBeNull();
  const sql=db.$queryRaw.mock.calls[0][0].sql;expect(sql).toContain("status='QUEUED'");expect(sql).toContain('SKIP LOCKED');expect(sql).not.toContain("status='CLAIMED'");
 });
 it('repeated acknowledgements preserve the confirmed print',async()=>{
  const {service,jobs,db}=fixture();jobs.set('job',{id:'job',stationId:'station',claimedById:'operator',status:'CLAIMED'});
  await service.finish('station','job',true,null,user);await service.finish('station','job',false,'late retry',user);
  expect(jobs.get('job').status).toBe('PRINTED');expect(db.auditLog.create).toHaveBeenCalledTimes(1);
 });
});
