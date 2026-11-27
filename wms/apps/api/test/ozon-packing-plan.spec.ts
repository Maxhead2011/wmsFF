import {describe,it,expect} from 'vitest';
import {validatePackingPlan,plannedSuggestions,assertPlannedUnit,assertPlannedBoxComplete,assertPlannedAction} from '../src/modules/client-requests/ozon-packing-plan';
const boxes=[{key:'a',boxCode:'FFL_A',supplyId:'s',direction:'M',items:[{skuId:'sku',barcode:'123',quantity:1,zone:'SORT'}]},{key:'b',boxCode:'FFL_B',supplyId:'s',direction:'M',items:[{skuId:'sku',barcode:'123',quantity:1,zone:'SORT'}]}];
const plan={version:1,state:'ACTIVE',boxes};const units:any[]=[{id:'u1',skuId:'sku',state:'PACKED',targetBoxCode:'FFL_A'},{id:'u2',skuId:'sku',state:'PICKED',targetBoxCode:null}];
const directions=[{name:'M',items:[{skuId:'sku',barcode:'123',quantity:2}]}];const link={mapping:{M:'s'},supplies:[{id:'s',items:[{barcode:'123',offerId:'x',quantity:2,placementZone:'SORT'}]}]};
// TEST: exact plan and transaction-time guards against wrong cartons and replayed units.
describe('Ozon planned packing',()=>{
 it('validates exact SKU and direction totals',()=>expect(validatePackingPlan(boxes,directions,link)).toHaveLength(2));
 it('rejects missing, duplicate, fractional, foreign supply and wrong zone',()=>{for(const changed of [boxes.slice(0,1),[...boxes,boxes[0]],boxes.map(b=>({...b,items:[{...b.items[0],quantity:0.5}]})),boxes.map(b=>({...b,supplyId:'other'})),boxes.map(b=>({...b,items:[{...b.items[0],zone:'NON_SORT'}]}))])expect(()=>validatePackingPlan(changed,directions,link)).toThrow();});
 it('routes to the next unfilled carton',()=>expect(plannedSuggestions(plan,units,[])[0]).toMatchObject({targetBoxCode:'FFL_B',skuId:'sku',remaining:1}));
 it('rejects wrong/full box and replayed unit',()=>{expect(()=>assertPlannedUnit(plan,units,'FFL_A','u2')).toThrow();expect(()=>assertPlannedUnit(plan,units,'FFL_B','u1')).toThrow();expect(()=>assertPlannedUnit(plan,units,'FFL_B','u2')).not.toThrow();});
 it('closes only exact completed cartons',()=>{expect(()=>assertPlannedBoxComplete(plan,units,'FFL_A')).not.toThrow();expect(()=>assertPlannedBoxComplete(plan,units,'FFL_B')).toThrow();expect(()=>assertPlannedBoxComplete(plan,[...units,{id:'u3',skuId:'other',state:'PACKED',targetBoxCode:'FFL_A'}],'FFL_A')).toThrow();});
 it('blocks bypass and uncertain external state',()=>{for(const action of ['MANUAL_PACK_UNIT','PACK_BOX','CANCEL_EMPTY_BOX'])expect(()=>assertPlannedAction(plan,action)).toThrow();expect(()=>assertPlannedAction({...plan,state:'SENDING'},'PACK_PRODUCT')).toThrow();expect(()=>assertPlannedAction(plan,'PACK_PRODUCT')).not.toThrow();});
});
