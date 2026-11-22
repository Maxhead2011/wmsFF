import { expect, it, vi } from 'vitest';
import { checkNewPickMark, palitraPickEnabled } from './palitra-pick-kiz';
const clientId='e8597352-0b93-442c-9582-c694620a9695';
const input={clientId,skuId:'sku1',boxId:'box1',warehouseId:'warehouse1',kiz:'010461046084052621ABCDEF'};
function fixture() {
  return {$queryRaw:vi.fn().mockResolvedValue([{id:'box1'}]),barcode:{findMany:vi.fn().mockResolvedValue([{skuId:'sku1'}])},
    productMark:{findFirst:vi.fn(),count:vi.fn().mockResolvedValue(2)},stockBalance:{aggregate:vi.fn().mockResolvedValue({_sum:{quantity:3}})},
    shippedKizHistory:{findFirst:vi.fn()},fboAssemblyUnit:{findFirst:vi.fn()},fbsTsdAssembly:{findFirst:vi.fn()}};
}
// TEST: one counted piece can receive its first physical identity without adding warehouse stock.
it('accepts only Palitra and its own installation flag',()=>{vi.stubEnv('WMS_PALITRA_PICK_KIZ','true');try{expect(palitraPickEnabled(clientId)).toBe(true);expect(palitraPickEnabled('other')).toBe(false);vi.stubEnv('WMS_PALITRA_PICK_KIZ','false');expect(palitraPickEnabled(clientId)).toBe(false);}finally{vi.unstubAllEnvs();}});
it('checks the registered GTIN and a free piece in the scanned box',async()=>{const t=fixture();await checkNewPickMark(t,input);expect(t.barcode.findMany.mock.calls[0][0].where.value.in).toContain('4610460840526');});
it('rejects a different SKU',async()=>{const t=fixture();t.barcode.findMany.mockResolvedValue([{skuId:'different'}]);await expect(checkNewPickMark(t,input)).rejects.toThrow();});
it('rejects a full set of assigned marks',async()=>{const t=fixture();t.productMark.count.mockResolvedValue(3);await expect(checkNewPickMark(t,input)).rejects.toThrow();});
it('rejects a previously shipped identity',async()=>{const t=fixture();t.shippedKizHistory.findFirst.mockResolvedValue({id:'prior'});await expect(checkNewPickMark(t,input)).rejects.toThrow();});
it('binds a loose piece to its existing warehouse movement',async()=>{
 const t={...fixture(),stockMovement:{findFirst:vi.fn().mockResolvedValue({id:'existing'})}};
 expect(await checkNewPickMark(t,{...input,boxId:null})).toBe('existing');
 expect(t.stockMovement.findFirst.mock.calls[0][0].where).toMatchObject({clientId,warehouseId:'warehouse1',boxId:null,palletId:null,status:'AVAILABLE'});
});
