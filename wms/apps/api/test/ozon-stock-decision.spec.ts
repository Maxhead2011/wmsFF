import {describe,expect,it} from 'vitest';
import {readOzonStockDecision} from '../src/modules/client-requests/ozon-stock-decision';
const items=[{skuId:'a',quantity:15,barcode:'123',name:'Товар'}];
const line={skuId:'a',requestedQuantity:15,availableQuantity:2,shortageQuantity:13};
describe('Ozon stock decision audit',()=>{
  // TEST: opening a correction is distinct from accepting the original quantities.
  it.each(['OPEN_CORRECTION','AS_IS'])('records the exact selection %s',mode=>{
    expect(readOzonStockDecision(JSON.stringify({mode,lines:[line]}),items)).toMatchObject({mode,requested:15,availableForPlan:2,shortages:[{shortage:13,barcode:'123'}]});
  });
  it('does not invent an action for a legacy caller',()=>expect(readOzonStockDecision(undefined,items)).toBeNull());
  it.each([[],[line,line],[{...line,shortageQuantity:0}],[{...line,requestedQuantity:12}]])('rejects mismatched evidence',(...lines)=>{
    expect(()=>readOzonStockDecision(JSON.stringify({mode:'AS_IS',lines}),items)).toThrow();
  });
});
