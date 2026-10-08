import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {preparePrintSeries,sendPrintSeries,submitPreparedSeries} from './printSeries';
afterEach(()=>vi.unstubAllGlobals());
// TEST: order survives asynchronous rendering and one job contains the full series.
it('prepares all pages and submits once',async()=> {
  vi.stubGlobal('crypto',{randomUUID:()=> 'same-operation'});
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'job'})});vi.stubGlobal('fetch',fetch);
  const p=await preparePrintSeries(['BOX_1','BOX_2'],{stationId:'s',clientId:'c',widthMm:60,heightMm:40},async v=>'data:image/png;base64,'+v);
  expect(fetch).not.toHaveBeenCalled();await sendPrintSeries('token',p);expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body).pages.map((x:any)=>x.value)).toEqual(['BOX_1','BOX_2']);
  await sendPrintSeries('token',p);expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
});
it('does not send a partial series when rendering fails',async()=> {
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(preparePrintSeries(['good','bad'],{stationId:'s',clientId:'c',widthMm:60,heightMm:40},async v=>{if(v==='bad')throw Error('render');return v;})).rejects.toThrow('render');
  expect(fetch).not.toHaveBeenCalled();
});
it('reuses UUID after a lost response, but a successful new click creates a new series',async()=> {
  vi.stubGlobal('crypto',webcrypto);const storage=new Map<string,string>();
  vi.stubGlobal('sessionStorage',{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
  const fetch=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue({ok:true,json:async()=>({id:'job',status:'queued'})});vi.stubGlobal('fetch',fetch);
  const p={stationId:'s',clientId:'c',widthMm:60,heightMm:40,pages:[{value:'1',imageBase64:'test'}]};
  await expect(submitPreparedSeries('token',p)).rejects.toThrow('offline');await submitPreparedSeries('token',p);await submitPreparedSeries('token',p);
  const ids=fetch.mock.calls.map(c=>JSON.parse(c[1].body).requestId);expect(ids[0]).toBe(ids[1]);expect(ids[2]).not.toBe(ids[1]);
});
