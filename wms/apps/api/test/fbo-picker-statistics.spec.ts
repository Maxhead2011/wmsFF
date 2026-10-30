import {afterEach,expect,it,vi} from 'vitest';
import {fboPickerStatistics} from '../src/modules/administration/fbo-picker-statistics';
afterEach(()=>vi.unstubAllEnvs());
const from=new Date('2026-10-29T21:00:00Z'),to=new Date('2026-10-30T21:00:00Z');
// TEST: one physical unit can have different picking and packing operators/days.
it('counts physical units separately by stage and unique requests without scan inflation',async()=>{
 vi.stubEnv('WMS_FBO_PICKER_STATISTICS_ENABLED','true');
 const groupBy=vi.fn().mockResolvedValueOnce([{requestId:'r',pickedByUserId:'a',_count:{_all:12},_min:{pickedAt:from},_max:{pickedAt:from}}]).mockResolvedValueOnce([{requestId:'r',packedByUserId:'b',_count:{_all:9},_min:{packedAt:from},_max:{packedAt:from}}]);
 const db={fboAssemblyUnit:{groupBy},clientRequest:{findMany:vi.fn().mockResolvedValue([{id:'r',number:2531,title:'Ozon',client:{name:'Елецкая'}}])},user:{findMany:vi.fn().mockResolvedValue([{id:'a',name:'Сборщик'},{id:'b',name:'Упаковщик'}])}};
 const result=await fboPickerStatistics(db as any,{isDemo:false,permissionCodes:['system:admin']} as any,{from,to});
 expect(result?.summary).toEqual({workers:2,requests:1,pickedUnits:12,packedUnits:9});
 expect(result?.workers.find(w=>w.workerId==='a')).toMatchObject({pickedUnits:12,packedUnits:0});
 expect(result?.workers.find(w=>w.workerId==='b')).toMatchObject({pickedUnits:0,packedUnits:9});
 expect(groupBy.mock.calls[0][0].where).toMatchObject({pickedAt:{gte:from,lt:to},state:{not:'RETURNED'},assembly:{request:{client:{isDemo:false}}}});
 expect(groupBy.mock.calls[1][0].where).toMatchObject({packedAt:{gte:from,lt:to},packedByUserId:{not:null}});
 expect(groupBy.mock.calls[0][0]).not.toHaveProperty('take');
});
it('does not query the sold installation when disabled',async()=>{
 vi.stubEnv('WMS_FBO_PICKER_STATISTICS_ENABLED','false');
 expect(await fboPickerStatistics({} as any,{} as any,{from,to})).toBeUndefined();
});
it('returns zero for an empty day and keeps branch/demo restrictions',async()=>{
 vi.stubEnv('WMS_FBO_PICKER_STATISTICS_ENABLED','true');
 const groupBy=vi.fn().mockResolvedValue([]);
 const result=await fboPickerStatistics({fboAssemblyUnit:{groupBy}} as any,{isDemo:true,roleCodes:['BRANCH_MANAGER'],warehouseIds:['w'],activeWarehouseId:'w'} as any,{from,to});
 expect(result?.summary).toEqual({workers:0,requests:0,pickedUnits:0,packedUnits:0});
 expect(groupBy.mock.calls[0][0].where.assembly.request).toMatchObject({warehouseId:'w',client:{isDemo:true}});
});
