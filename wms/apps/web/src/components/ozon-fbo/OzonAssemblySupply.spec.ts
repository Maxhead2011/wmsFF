import {it,expect} from 'vitest';
import {cargoMappingReady} from './OzonAssemblySupply';
// TEST: a multi-direction partial success must not enable the complete mapping download.
it('enables the file only after every mapped direction succeeds, including after reload',()=>{
 const data:any={directions:[{name:'Ростов'},{name:'Москва'}],link:{mapping:{Ростов:'1',Москва:'2'},operations:{'1':{state:'SUCCESS'}}}};
 expect(cargoMappingReady(null)).toBe(false);expect(cargoMappingReady(data)).toBe(false);
 for(const state of ['UNKNOWN','SENDING','ACCEPTED','FAILED']){data.link.operations['2']={state};expect(cargoMappingReady(data)).toBe(false);}
 data.link.operations['2']={state:'SUCCESS'};expect(cargoMappingReady(JSON.parse(JSON.stringify(data)))).toBe(true);
 delete data.link.mapping.Москва;expect(cargoMappingReady(data)).toBe(false);
});
