import { it, expect, vi } from 'vitest';
import { TsdAssemblyService } from '../src/modules/tsd/tsd-assembly.service';
// TEST: units must be summed, not confused with distinct item rows.
it('returns WMS number and total units in the assembly list', async () => {
 const findMany=vi.fn().mockResolvedValue([{id:'r',number:2656,title:'Ozon',status:'IN_WORK',createdAt:new Date(),updatedAt:new Date(),items:[{quantity:7},{quantity:2}],_count:{items:2},pickWaveRequests:[]}]);
 const s=new TsdAssemblyService({clientRequest:{findMany}} as never,{resolveClientFilter:()=>undefined} as never,{} as never,{} as never,{} as never);
 vi.spyOn(s as any,'loadActiveTsdProcesses').mockResolvedValue(new Map());
 const [r]=await s.listActiveRequests({id:'u'} as never);
 expect(r).toMatchObject({number:2656,totalQuantity:9,rowsCount:2});
 expect(findMany.mock.calls[0][0].select).toMatchObject({number:true,items:{select:{quantity:true}}});
});
