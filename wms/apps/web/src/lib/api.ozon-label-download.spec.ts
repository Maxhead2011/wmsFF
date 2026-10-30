import {afterEach,expect,it,vi} from 'vitest';
import {recordOzonLabelDownload} from './api';
afterEach(()=>vi.unstubAllGlobals());
// TEST: explicit authenticated POST records only the selected supply, never a client URL/actor.
it('records the selected request and supply before returning a label URL',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({url:'https://cdn.ozon.ru/a.pdf'})});vi.stubGlobal('fetch',fetch);
 expect(await recordOzonLabelDownload('token','request/1','42')).toEqual({url:'https://cdn.ozon.ru/a.pdf'});
 const [url,options]=fetch.mock.calls[0];expect(url).toContain('/requests/request%2F1/supply/label-download');expect(options.method).toBe('POST');expect(JSON.parse(options.body)).toEqual({supplyId:'42'});
});
it('propagates history failure instead of returning an unrecorded link',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:500,json:async()=>({message:'History unavailable'})}));
 await expect(recordOzonLabelDownload('token','r','42')).rejects.toThrow('History unavailable');
});
