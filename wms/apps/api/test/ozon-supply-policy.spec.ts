import {describe,it,expect} from 'vitest';
import {supplyDifferences,packedCargoes,cargoHash,assertSupplyMutable,SupplyIntegration} from '../src/modules/client-requests/ozon-supply-policy';
// TEST: customer demand, destination quotas and post-upload immutability.
const directions=[{name:'Москва',items:[{skuId:'sku',barcode:'123',quantity:2}]}];
const link:SupplyIntegration={connectionId:'c',orderId:'1',orderNumber:'1',place:'x',date:'',state:'DATA_FILLING',checkedAt:'',supplies:[{id:'s',name:'Москва',items:[{barcode:'123',offerId:'article',quantity:2,quant:1}]}],mapping:{Москва:'s'},operations:{}};
const assembly={phase:'CONTROL',boxes:[{id:'b',boxId:'box',direction:'Москва',closedAt:'now',confirmedAt:'now'}],units:[1,2].map(()=>({skuId:'sku',targetBoxId:'box',state:'PACKED'}))};
describe('Ozon physical cargo policy',()=>{
 it('exports actual verified boxes without changing source demand',()=>{expect(supplyDifferences(directions,link)).toEqual([]);const c=packedCargoes(directions,link,assembly);expect(c.s[0].value.items[0]).toEqual({barcode:'123',offer_id:'article',quantity:2,quant:1});expect(cargoHash(c)).toBe(cargoHash(c));});
 it('blocks unmatched directions and quantity discrepancies',()=>{expect(supplyDifferences(directions,{...link,mapping:{}})).toHaveLength(2);expect(()=>packedCargoes([{...directions[0],items:[{...directions[0].items[0],quantity:3}]}],link,assembly)).toThrow('расхождения');});
 it('rejects unverified, missing and wrong-destination units',()=>{expect(()=>packedCargoes(directions,link,{...assembly,boxes:[{...assembly.boxes[0],confirmedAt:null}]})).toThrow('проверьте');expect(()=>packedCargoes(directions,link,{...assembly,units:assembly.units.slice(0,1)})).toThrow('Количество');});
 it('freezes edits but permits final completion and leaves WB untouched',()=>{expect(()=>assertSupplyMutable({...link,frozenHash:'hash'},'PACK_UNIT')).toThrow('зафиксирован');expect(()=>assertSupplyMutable({...link,frozenHash:'hash'},'FINISH')).not.toThrow();expect(()=>assertSupplyMutable(null,'PACK_UNIT')).not.toThrow();});
});
