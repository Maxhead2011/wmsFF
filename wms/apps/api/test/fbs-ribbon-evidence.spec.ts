import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {rememberRibbon,readRibbon,confirmRibbon} from '../src/common/stock/fbs-ribbon-evidence';
// TEST: arbitrary PDFs and mismatched clients/users cannot start a request.
describe('trusted ribbon evidence',()=>{
 beforeEach(()=>vi.stubEnv('WMS_FBS_ACTION_STATUS_ENABLED','true'));afterEach(()=>vi.unstubAllEnvs());
 function fixture(){const values=new Map<string,any>();values.set('fbs.action-status.v1:c',{startOnRibbon:true});const db:any={systemSetting:{findUnique:vi.fn(async({where}:any)=>values.has(where.key)?{value:values.get(where.key)}:null),upsert:vi.fn(async(x:any)=>values.set(x.where.key,x.update.value))},fbsOrderRequestLink:{findMany:vi.fn(async()=>[{requestId:'r',connectionId:'shop',orderId:'o'}])}};return {db,values};}
 const orders=[{id:'o',connectionId:'shop',marketplace:'WILDBERRIES'}];
 it('binds exact server PDF to client, user and warehouse-filtered active links',async()=>{const {db}=fixture();await rememberRibbon(db,'c','u',orders,Buffer.from('pdf'));expect(await readRibbon(db,'c','u',Buffer.from('pdf'),'w')).toHaveLength(1);expect(db.fbsOrderRequestLink.findMany.mock.calls[0][0].where.request.warehouseId).toBe('w');expect(await readRibbon(db,'c','other',Buffer.from('pdf'),'w')).toEqual([]);expect(await readRibbon(db,'c','u',Buffer.from('changed'),'w')).toEqual([]);});
 it('rejects expired evidence and leaves non-fabric clients untouched',async()=>{const {db,values}=fixture();await rememberRibbon(db,'c','u',orders,Buffer.from('pdf'));for(const [key,value] of values)if(key.startsWith('fbs.ribbon'))value.generatedAt=0;expect(await readRibbon(db,'c','u',Buffer.from('pdf'),'w')).toEqual([]);await rememberRibbon(db,'ordinary','u',orders,Buffer.from('pdf'));expect(db.systemSetting.upsert).toHaveBeenCalledTimes(1);});
 it('flag-off and unbound series are no-ops',async()=>{vi.stubEnv('WMS_FBS_ACTION_STATUS_ENABLED','false');await rememberRibbon(null,'c','u',orders,Buffer.from('pdf'));expect(await readRibbon(null,'c','u',Buffer.from('pdf'),'w')).toEqual([]);await confirmRibbon(null,{},'j',new Date());});
});
