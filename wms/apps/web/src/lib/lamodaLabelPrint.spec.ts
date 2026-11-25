import {afterEach,expect,it,vi} from 'vitest';
import {previewLamodaLabel,printLamodaLabels} from './lamodaLabelPrint';
import {submitPreparedSeries} from './printSeries';
vi.mock('./printSeries',()=>({submitPreparedSeries:vi.fn(async()=>({id:'job'}))}));
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
function setup(change={}){const f=vi.fn(async(_url:string)=>new Response(JSON.stringify({clientId:'c',skuId:'s',barcode:'4640684268387',article:'MP1',widthMm:58,heightMm:40,imageBase64:'png',pdfBase64:'pdf',...change})));vi.stubGlobal('fetch',f);return f;}
// TEST: warehouse barcode never overrides the confirmed Lamoda identity.
it('uses Lamoda identity and scopes preview',async()=>{const f=setup();await previewLamodaLabel('t','c',{id:'s',barcodes:[{value:'205',source:'WAREHOUSE'}]},'205');expect(String(f.mock.calls[0]?.[0])).not.toContain('barcode=');expect(submitPreparedSeries).not.toHaveBeenCalled();});
it('rejects another client before printing',async()=>{setup({clientId:'other'});await expect(printLamodaLabels('t','c',[{id:'s'}],{},'AGENT:a',{},vi.fn())).rejects.toThrow('не соответствуют');expect(submitPreparedSeries).not.toHaveBeenCalled();});
it('sends 58x40 with exact requested copies',async()=>{setup();await printLamodaLabels('t','c',[{id:'s'}],{s:2},'AGENT:a',{},vi.fn());expect(submitPreparedSeries).toHaveBeenCalledWith('t',expect.objectContaining({stationId:'a',widthMm:58,heightMm:40,pages:[{value:'4640684268387',imageBase64:'png'},{value:'4640684268387',imageBase64:'png'}]}));});
it('does not queue any labels if a later SKU fails',async()=>{const f=setup();f.mockResolvedValueOnce(new Response(JSON.stringify({message:'Нет состава'}),{status:400}));await expect(printLamodaLabels('t','c',[{id:'s'},{id:'s2'}],{},'AGENT:a',{},vi.fn())).rejects.toThrow('Нет состава');expect(submitPreparedSeries).not.toHaveBeenCalled();});
it('opens browser printing only on explicit action',async()=>{setup();const print=vi.fn();await printLamodaLabels('t','c',[{id:'s'}],{s:2},'LOCAL_BROWSER',{},print);expect(print).toHaveBeenCalledWith([{imageBase64:'png',copies:2}],58,40);expect(submitPreparedSeries).not.toHaveBeenCalled();});
it('rejects unsupported printer and invalid copy counts before reads',async()=>{const f=setup();await expect(printLamodaLabels('t','c',[{id:'s'}],{},'legacy',{},vi.fn())).rejects.toThrow('агент');await expect(printLamodaLabels('t','c',[{id:'s'}],{s:501},'AGENT:a',{},vi.fn())).rejects.toThrow('500');expect(f).not.toHaveBeenCalled();});
