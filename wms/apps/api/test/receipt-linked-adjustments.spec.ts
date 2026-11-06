import {afterEach,expect,it,vi} from 'vitest';
import {receiptDocuments} from '../src/modules/warehouse/receipt-channel-policy';
import {ReceiptChannelsController} from '../src/modules/warehouse/receipt-channels.controller';
import ExcelJS from 'exceljs';
afterEach(()=>vi.unstubAllEnvs());
function fixture(){
 const original=[{boxId:'b',sourceDocument:'doc',createdAt:new Date('2026-11-06T10:00:00Z'),quantity:953}];
 const corrections=[{id:'plus',boxId:'b',skuId:'s1',sourceDocument:'check',createdAt:new Date('2026-11-06T16:00:00Z'),quantity:10,type:'INVENTORY_ADJUSTMENT',clientId:'c',warehouseId:'w'}, {id:'minus',boxId:'b',skuId:'s2',sourceDocument:'check',createdAt:new Date('2026-11-06T16:00:00Z'),quantity:-2,type:'INVENTORY_ADJUSTMENT',clientId:'c',warehouseId:'w'}];
 const link={clientId:'c',warehouseId:'w',sourceDocument:'SERIES:2026:BOX',movements:corrections.map(m=>({...m,receiptDocument:'doc'}))};
 const db:any={stockMovement:{findMany:vi.fn(async(q:any)=>q.where.type==='INVENTORY_ADJUSTMENT'?corrections:original)},tsdOperation:{findMany:vi.fn().mockResolvedValue([])},box:{findMany:vi.fn().mockResolvedValue([{id:'b',code:'BOX_1',status:'active'}])},systemSetting:{findMany:vi.fn(async(q:any)=>q.where.key.startsWith.startsWith('receipt.adjustments.v1:')?[{value:link}]:[])}};
 return {db,link,corrections};
}
// TEST: accepted receipt corrections affect the report once, including negative SKU corrections, without stock writes.
it('includes explicitly linked signed adjustments in receipt and export IDs',async()=>{
 vi.stubEnv('WMS_RECEIPT_LINKED_ADJUSTMENTS_ENABLED','true');const {db}=fixture();
 const [doc]=await receiptDocuments(db,'c','w',undefined,undefined,true);
 expect(doc.received).toBe(961);expect((doc.boxes[0] as any).linkedAdjustmentIds).toEqual(['plus','minus']);
 expect((await receiptDocuments(db,'c','w',undefined,undefined,true))[0].received).toBe(961);
});
it('leaves sold and operational paths unchanged',async()=>{
 const {db}=fixture();vi.stubEnv('WMS_RECEIPT_LINKED_ADJUSTMENTS_ENABLED','false');
 expect((await receiptDocuments(db,'c','w',undefined,undefined,true))[0].received).toBe(953);
 vi.stubEnv('WMS_RECEIPT_LINKED_ADJUSTMENTS_ENABLED','true');expect((await receiptDocuments(db,'c','w'))[0].received).toBe(953);
});
it.each(['quantity','boxId','clientId','warehouseId','sourceDocument'])('rejects stale or cross-scope movement %s',async(field)=>{
 vi.stubEnv('WMS_RECEIPT_LINKED_ADJUSTMENTS_ENABLED','true');const {db,corrections}=fixture();
 (corrections[0] as any)[field]=field==='quantity'?99:'foreign';
 await expect(receiptDocuments(db,'c','w',undefined,undefined,true)).rejects.toThrow();
});
// TEST: downloadable receipt retains signed corrections and exactly the report total.
it('exports final quantities without separate signed movements',async()=>{
 vi.stubEnv('WMS_RECEIPT_LINKED_ADJUSTMENTS_ENABLED','true');
 const sku={name:'Product',article:'A',size:'M',barcodes:[{value:'123'}]};
 const db:any={stockMovement:{findMany:vi.fn(async()=>[953,10,-2].map(quantity=>({quantity,sku,skuId:'s',boxId:'b',createdAt:new Date('2026-11-06')})))}};
 const controller:any=new ReceiptChannelsController(db,{} as any,{} as any);
 controller.readReceipt=async()=>({date:'2026-11-06',boxes:[{id:'b',code:'BOX_1',receiptDocument:'doc',linkedAdjustmentIds:['plus','minus']}]});
 let data:any;await controller.file({},'c','w','id',{setHeader:vi.fn(),send:(b:any)=>{data=b;}});
 expect(db.stockMovement.findMany.mock.calls[0][0].where.OR[1]).toEqual({type:'INVENTORY_ADJUSTMENT',id:{in:['plus','minus']}});
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(data);let total=0;wb.worksheets[0].eachRow((row,i)=>{if(i>1)total+=Number(row.getCell(7).value);});expect(total).toBe(961);expect(wb.worksheets[0].rowCount).toBe(2);
});
