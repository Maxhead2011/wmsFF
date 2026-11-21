import {it,expect} from 'vitest';
import {assertOzonBoxZones} from './ozon-box-zones';
// TEST: Palitra 2.5 and 5 kg are sortable, 10 kg is not.
it('checks placement only across different SKUs',()=>{
 const items=['small','middle','large'].map((skuId,i)=>({skuId,barcode:skuId,quantity:1,placementZone:i===2?'NON_SORT':'SORT'}));
 const check=(added:string)=>assertOzonBoxZones({mapping:{A:'1'},supplies:[{id:'1',items}]},'A',[{name:'A',items}],['small'],added);
 expect(()=>check('small')).not.toThrow();
 expect(()=>check('middle')).not.toThrow();
 expect(()=>check('large')).toThrow('Выберите другой короб');
 expect(()=>check('missing')).toThrow('неизвестна');
});
import {ozonPackingSuggestions} from './ozon-packing-suggestion';
// TEST: a rejected placement must not direct the operator back to the same carton.
it('suggests a new box when the open box has a different zone',()=>{
 const items=['a','b'].map((skuId,i)=>({skuId,barcode:skuId,quantity:1,placementZone:i?'SORT':'NON_SORT'}));
 const suggestions=ozonPackingSuggestions([{name:'A',items}],[{boxId:'1',boxCode:'FFL_1',direction:'A'}],[{skuId:'a',state:'PACKED',targetBoxId:'1'},{skuId:'b',state:'PICKED'}],{integration:{mapping:{A:'s'},supplies:[{id:'s',items}]}});
 expect(suggestions[0].targetBoxCode).toBeNull();
});
// TEST: an unknown third SKU must never hide a conflict between two known zones.
it.each(['634434d6-0d5a-4f6b-8876-6c8d3252cdff','c401202c-be57-4310-9939-2ea36767da37'])('handles unknown zones for client %s',clientId=>{
 const items=['unknown','small','large'].map((skuId,i)=>({skuId,barcode:skuId,quantity:1,placementZone:['UNKNOWN','SORT','NON_SORT'][i]}));
 const directions=[{name:'A',items}],integration={mapping:{A:'s'},supplies:[{id:'s',items}]};
 const check=(packed:string[],added:string,client:string)=>assertOzonBoxZones(integration,'A',directions,packed,added,client);
 expect(()=>check(['unknown'],'small',clientId)).not.toThrow();
 expect(()=>check(['unknown','small'],'large',clientId)).toThrow('разные зоны');
 expect(()=>check(['unknown'],'small','another-client')).toThrow('неизвестна');
 const suggestions=ozonPackingSuggestions(directions,[{direction:'A',boxId:'1',boxCode:'FFL_1'}],[{skuId:'unknown',state:'PACKED',targetBoxId:'1'},{skuId:'small',state:'PICKED'}],{integration,clientId});
 expect(suggestions[0].targetBoxCode).toBe('FFL_1');
});
