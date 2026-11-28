import {afterEach,expect,it,vi} from 'vitest';
import {TsdKizBoxPrintService} from '../src/modules/tsd/tsd-kiz-box-print.service';
import {ClientScopeService} from '../src/modules/auth/client-scope.service';
vi.mock('../src/modules/tsd/tsd-kiz-box-label',()=>({buildKizBoxLabel:vi.fn(async(code:string)=>'PNG:'+code)}));
const kiz='0104640684266352215pwnNt7VfBWyc';
const user:any={id:'worker',name:'Worker',activeWarehouseId:'wh',warehouseIds:['wh'],clientScopeMode:'ALL',permissionCodes:[],hiddenClientIds:[],deviceCode:'TSD'};
const body={kiz,stationId:'printer',printId:'11111111-1111-4111-8111-111111111111'};
function fixture(){
 vi.stubEnv('WMS_TSD_KIZ_BOX_PRINT_ENABLED','true');let jobs:any[]=[];
 const db:any={productMark:{findMany:vi.fn(async()=>[{id:'mark',clientId:'client',value:kiz,status:'AVAILABLE',box:{id:'box',code:'FFL_123',status:'active',clientId:'client',warehouseId:'wh',pallet:null}}])},storagePalletBox:{findMany:vi.fn(async()=>[{boxId:'box',boxCode:'FFL_123',pallet:{code:'VP_PALET_SORT_001',clientId:'client',warehouseId:'wh'}}])},fbsPrintStation:{findMany:vi.fn(async()=>[{id:'printer',name:'Printer'}])},fbsPrintJob:{findUnique:vi.fn(async({where}:any)=>jobs.find(j=>j.historyId===where.historyId)),create:vi.fn(async({data}:any)=>{const j={...data,id:'job',status:'QUEUED'};jobs.push(j);return j;})},auditLog:{create:vi.fn()},$transaction:async(fn:any)=>fn(db)};
 return {db,jobs,svc:new TsdKizBoxPrintService(db,new ClientScopeService())};
}
afterEach(()=>vi.unstubAllEnvs());
// TEST: worker access is separate from administrative KIZ decisions.
it('worker finds current virtual pallet and creates exactly one printing-only pair',async()=>{const {svc,db}=fixture();const found=await svc.lookup(kiz,user);expect(found.palletCode).toBe('VP_PALET_SORT_001');await svc.create(body,user);expect(db.fbsPrintJob.create).toHaveBeenCalledTimes(1);expect(db.fbsPrintJob.create.mock.calls[0][0].data).toMatchObject({source:'TSD_KIZ_BOX_LABELS',stickerCode:'FFL_123',productName:'VP_PALET_SORT_001'});expect(db.auditLog.create).toHaveBeenCalledTimes(1);});
it('retry returns original job without another pair',async()=>{const {svc,db}=fixture();await svc.create(body,user);await svc.create(body,user);expect(db.fbsPrintJob.create).toHaveBeenCalledTimes(1);});
it('print key cannot be reused for another KIZ or printer',async()=>{const {svc}=fixture();await svc.create(body,user);await expect(svc.create({...body,stationId:'other'},user)).rejects.toThrow();await expect(svc.create({...body,kiz:kiz.replace('BWyc','BWyd')},user)).rejects.toThrow();});
it('missing KIZ and missing box do not enqueue',async()=>{const {svc,db}=fixture();db.productMark.findMany.mockResolvedValue([]);await expect(svc.create(body,user)).rejects.toThrow('КИЗ не найден в системе');expect(db.fbsPrintJob.create).not.toHaveBeenCalled();});
it('unknown pallet and ambiguous marks do not enqueue',async()=>{const {svc,db}=fixture();db.storagePalletBox.findMany.mockResolvedValue([]);await expect(svc.create(body,user)).rejects.toThrow('паллет');const m=(await db.productMark.findMany())[0];db.productMark.findMany.mockResolvedValue([m,{...m,id:'other'}]);await expect(svc.create(body,user)).rejects.toThrow('несколько');});
it('foreign branch, demo and disabled installation are rejected',async()=>{const {svc}=fixture();await expect(svc.lookup(kiz,{...user,warehouseIds:['other']})).rejects.toThrow();await expect(svc.lookup(kiz,{...user,isDemo:true})).rejects.toThrow();vi.stubEnv('WMS_TSD_KIZ_BOX_PRINT_ENABLED','false');await expect(svc.lookup(kiz,user)).rejects.toThrow();});
it('offline station cannot receive job',async()=>{const {svc,db}=fixture();db.fbsPrintStation.findMany.mockResolvedValue([]);await expect(svc.create(body,user)).rejects.toThrow('принтер');expect(db.fbsPrintJob.create).not.toHaveBeenCalled();});
it('longer serial prefix is not the scanned identity',async()=>{const {svc,db}=fixture();const m=(await db.productMark.findMany())[0];db.productMark.findMany.mockResolvedValue([{...m,value:kiz+'X'}]);await expect(svc.lookup(kiz,user)).rejects.toThrow();});
