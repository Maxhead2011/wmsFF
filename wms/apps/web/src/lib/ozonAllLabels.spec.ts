import {describe,it,expect,vi} from 'vitest';
import {prepareOzonAllLabels} from './ozonAllLabels';
const m={clientId:'c',fingerprint:'hash',total:2,supplies:[{id:'1',name:'A',cargoIds:['11']},{id:'2',name:'B',cargoIds:['22']}]};
const part=async(id:string)=>({...m,widthMm:120,heightMm:75,pages:[{value:id==='1'?'11':'22',imageBase64:'png'}]});
describe('whole Ozon assembly print preparation',()=>{
 // TEST: no partial series escapes preparation or includes an unrelated cargo.
 it('collects all directions once before submission',async()=>{const fn=vi.fn(part);const r=await prepareOzonAllLabels(m,'station',fn,async()=>m,()=>{});expect(r.pages.map(p=>p.value)).toEqual(['11','22']);expect(fn).toHaveBeenCalledTimes(2);});
 it('fails the entire preparation when any direction fails',async()=>{await expect(prepareOzonAllLabels(m,'s',async id=>{if(id==='2')throw Error('429');return part(id);},async()=>m,()=>{})).rejects.toThrow('429');});
 it('rejects changed manifest during or after preparation',async()=>{await expect(prepareOzonAllLabels(m,'s',async id=>({...await part(id),fingerprint:'changed'}),async()=>m,()=>{})).rejects.toThrow();await expect(prepareOzonAllLabels(m,'s',part,async()=>({...m,fingerprint:'changed'}),()=>{})).rejects.toThrow();});
 it('rejects missing or unrelated labels',async()=>{await expect(prepareOzonAllLabels(m,'s',async id=>({...await part(id),pages:[]}),async()=>m,()=>{})).rejects.toThrow();await expect(prepareOzonAllLabels(m,'s',async id=>({...await part(id),pages:[{value:'wrong',imageBase64:'png'}]}),async()=>m,()=>{})).rejects.toThrow();});
});
