import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {checkOzonImportStock,OzonImportStockReview} from './OzonImportStockReview';
import {previewClientRequestAvailability} from '../../lib/api';
vi.mock('../../lib/api',()=>({previewClientRequestAvailability:vi.fn()}));
const availability:any={canCommit:false,summary:{requestedQuantity:10,shortageQuantity:3},lines:[{skuId:'s',name:'Платье',barcode:'123',requestedQuantity:10,stockQuantity:9,reservedQuantity:2,availableQuantity:7,pendingPlacementQuantity:2,shortageQuantity:3}]};
// TEST: all destinations compete for the same stock; pending placement is visible, not a shortage.
it('checks aggregated demand in the selected client/branch and excludes an existing request',async()=>{
 vi.mocked(previewClientRequestAvailability).mockResolvedValue(availability);
 const p:any={directions:[{name:'A',items:[{skuId:'s',barcode:'123',quantity:6}]},{name:'B',items:[{skuId:'s',barcode:'123',quantity:4}]}],items:[{skuId:'s',name:'Платье'}],existingRequest:{id:'old'}};
 expect(await checkOzonImportStock('token','client','branch',p)).toEqual(availability);
 expect(previewClientRequestAvailability).toHaveBeenCalledWith('token',{clientId:'client',warehouseId:'branch',type:'OUTBOUND',excludeRequestId:'old',items:[{skuId:'s',barcode:'123',name:'Платье',quantity:10}]});
});
it('shows the deficit and both explicit choices without blocking full demand',()=>{
 const html=renderToStaticMarkup(<OzonImportStockReview stock={availability} busy={false} onAdjust={()=>{}} onCreate={()=>{}} source="link"/>);
 for(const text of ['Платье','123','Не хватает','В резервах','Принято, не размещено','Скорректировать по фактическим остаткам','Сформировать как есть'])expect(html).toContain(text);
 expect(html).not.toContain('disabled=""');
});
it('explains file binding and disables adjustment without a deficit',()=>{
 const html=renderToStaticMarkup(<OzonImportStockReview stock={{...availability,canCommit:true}} busy={false} onAdjust={()=>{}} onCreate={()=>{}} source="file"/>);
 expect(html).toContain('привязать поставку Ozon');expect(html).toMatch(/disabled=""[^>]*>Скорректировать/);
});
