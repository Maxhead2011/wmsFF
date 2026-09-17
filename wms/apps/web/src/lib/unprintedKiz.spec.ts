import {afterEach,expect,it,vi} from 'vitest';
import {checkUnprintedKiz,createUnprintedKizSearch} from './unprintedKiz';
afterEach(()=>vi.unstubAllGlobals());
// TEST: report is GET; creation carries explicit selection, scope and stable retry identity.
it('sends the period and scope separately from the explicit search request',async()=>{
  const fetch=vi.fn(async()=>({ok:true,json:async()=>({})}));vi.stubGlobal('fetch',fetch);
  const filter={clientId:'c',warehouseId:'w',dateFrom:'2026-09-14',dateTo:'2026-09-15'};
  await checkUnprintedKiz('token',filter);
  const first=fetch.mock.calls[0] as any;expect(new URL(first[0],'https://test').searchParams.get('warehouseId')).toBe('w');expect(first[1].method??'GET').toBe('GET');
  const input={...filter,scanIds:['scan'],assignedToUserId:'worker',operationId:'stable'};
  await createUnprintedKizSearch('token',input);
  const second=fetch.mock.calls[1] as any;expect(second[1].method).toBe('POST');expect(JSON.parse(second[1].body)).toEqual(input);
});

// TEST: no empty/undefined dates travel with a reference scope.
it('sends request or supply without dates',async()=>{
 const fetch=vi.fn(async()=>({ok:true,json:async()=>({})}));vi.stubGlobal('fetch',fetch);
 await checkUnprintedKiz('token',{clientId:'c',warehouseId:'w',requestNumber:'001029'});
 let q=new URL((fetch.mock.calls[0] as any)[0],'https://test').searchParams;
 expect(q.get('requestNumber')).toBe('001029');expect(q.has('dateFrom')).toBe(false);
 await checkUnprintedKiz('token',{clientId:'c',warehouseId:'w',supplyId:'WB-GI-123'});
 q=new URL((fetch.mock.calls[1] as any)[0],'https://test').searchParams;expect(q.get('supplyId')).toBe('WB-GI-123');expect(q.has('dateTo')).toBe(false);
});
