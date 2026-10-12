import {it,expect,vi,afterEach} from 'vitest';
vi.mock('../src/common/stock/wb-order-stock-lifecycle',()=>({wbReservationQuantities:vi.fn(async()=>new Map([['sku',1]]))}));
import {unboxedFree,pickUnboxed} from '../src/modules/tsd/fbo-unboxed-picking';
afterEach(()=>vi.unstubAllEnvs());
function setup(quantity=2){
 vi.stubEnv('WMS_FBO_UNBOXED_PICK_ENABLED','true');
 const tx:any={stockBalance:{findMany:vi.fn(async()=>[{skuId:'sku',quantity}])},productMark:{findFirst:vi.fn(async()=>null)},box:{upsert:vi.fn(async()=>({id:'holding'}))},fboAssemblyUnit:{create:vi.fn(async()=>({}))}};
 const r={id:'r',clientId:'c',warehouseId:'w',client:{storesWithoutBoxes:true}},lines=[{id:'line',skuId:'sku',barcode:'123',remaining:1,sku:{barcodes:[],needsChestnyZnak:false}}],dto={action:'PICK_UNIT',barcode:'123'},move=vi.fn(async()=>({id:'move'}));
 return {tx,r,lines,dto,move};
}
// TEST: physical source is null, other requests are reserved, and no location is fabricated.
it('moves one free unit from scoped loose stock and records no source box',async()=>{
 const s=setup();await pickUnboxed(s.tx,s.r,s.lines,s.dto,'key',{id:'u'},s.move,vi.fn());
 expect(s.move.mock.calls[0].slice(2,9)).toEqual(['sku',null,'holding','AVAILABLE','PACKING',1,expect.stringContaining('key:')]);
 expect(s.tx.fboAssemblyUnit.create).toHaveBeenCalledWith({data:expect.objectContaining({sourceBoxId:'',sourceBoxCode:'',wholeBox:false,requestId:'r'})});
 expect(s.tx.stockBalance.findMany).toHaveBeenCalledWith({where:expect.objectContaining({warehouseId:'w',clientId:'c',boxId:null,palletId:null,status:'AVAILABLE'})});
});
it('preserves the final unit reserved for another order',async()=>{const s=setup(1);await expect(pickUnboxed(s.tx,s.r,s.lines,s.dto,'k',{id:'u'},s.move,vi.fn())).rejects.toThrow('зарезервирован');expect(s.move).not.toHaveBeenCalled();});
it.each([{action:'PICK_BOX'},{sourceBoxCode:'box'},{palletCode:'pallet'},{barcode:'wrong'}])('rejects invalid loose command %j',async change=>{const s=setup();await expect(pickUnboxed(s.tx,s.r,s.lines,{...s.dto,...change},'k',{id:'u'},s.move,vi.fn())).rejects.toThrow();expect(s.move).not.toHaveBeenCalled();});
it('requires KIZ for marked goods before changing stock',async()=>{const s=setup();s.lines[0].sku.needsChestnyZnak=true;await expect(pickUnboxed(s.tx,s.r,s.lines,s.dto,'k',{id:'u'},s.move,vi.fn())).rejects.toThrow('КИЗ');expect(s.move).not.toHaveBeenCalled();});
it('does not allow a boxed client to bypass its source scan',async()=>{const s=setup();s.r.client.storesWithoutBoxes=false;await expect(pickUnboxed(s.tx,s.r,s.lines,s.dto,'k',{id:'u'},s.move,vi.fn())).rejects.toThrow();});
it('sums negative corrections rather than ignoring them',async()=>{const s=setup();s.tx.stockBalance.findMany.mockResolvedValue([{skuId:'sku',quantity:4},{skuId:'sku',quantity:-3}]);expect((await unboxedFree(s.tx,s.r,['sku'])).get('sku')).toBe(0);});
