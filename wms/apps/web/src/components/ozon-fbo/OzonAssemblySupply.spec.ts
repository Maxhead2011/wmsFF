import {it,expect,vi,afterEach} from 'vitest';
import {cargoMappingReady,openRecordedOzonLabels} from './OzonAssemblySupply';
// TEST: a multi-direction partial success must not enable the complete mapping download.
it('enables the file only after every mapped direction succeeds, including after reload',()=>{
 const data:any={directions:[{name:'Ростов'},{name:'Москва'}],link:{mapping:{Ростов:'1',Москва:'2'},operations:{'1':{state:'SUCCESS'}}}};
 expect(cargoMappingReady(null)).toBe(false);expect(cargoMappingReady(data)).toBe(false);
 for(const state of ['UNKNOWN','SENDING','ACCEPTED','FAILED']){data.link.operations['2']={state};expect(cargoMappingReady(data)).toBe(false);}
 data.link.operations['2']={state:'SUCCESS'};expect(cargoMappingReady(JSON.parse(JSON.stringify(data)))).toBe(true);
 delete data.link.mapping.Москва;expect(cargoMappingReady(data)).toBe(false);
});

// TEST: a successful history receipt gates navigation; blocked windows and failed writes are explicit.
afterEach(()=>vi.unstubAllGlobals());
it('waits for history persistence before navigating the new tab',async()=>{
 const tab={opener:{},location:{replace:vi.fn()},close:vi.fn()};vi.stubGlobal('window',{open:vi.fn(()=>tab)});
 let resolve!:(v:{url:string})=>void;const record=vi.fn(()=>new Promise<{url:string}>(r=>resolve=r));
 const pending=openRecordedOzonLabels(record);expect(tab.location.replace).not.toHaveBeenCalled();expect(tab.opener).toBeNull();resolve({url:'https://cdn.ozon.ru/a'});await pending;expect(tab.location.replace).toHaveBeenCalledWith('https://cdn.ozon.ru/a');
});
it('closes the blank tab and surfaces a failed history write',async()=>{
 const tab={opener:null,location:{replace:vi.fn()},close:vi.fn()};vi.stubGlobal('window',{open:()=>tab});
 await expect(openRecordedOzonLabels(async()=>{throw Error('history failed');})).rejects.toThrow('history failed');expect(tab.close).toHaveBeenCalledOnce();expect(tab.location.replace).not.toHaveBeenCalled();
});
it('does not record a click as opened when the popup is blocked',async()=>{
 vi.stubGlobal('window',{open:()=>null});const record=vi.fn();await expect(openRecordedOzonLabels(record)).rejects.toThrow('Разрешите');expect(record).not.toHaveBeenCalled();
});
