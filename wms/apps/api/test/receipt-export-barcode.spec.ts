import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { ReceiptChannelsController } from '../src/modules/warehouse/receipt-channels.controller';

// TEST: real 1310 regression: GTIN is first, but the receipt scan has the label barcode.
async function exportBarcode(payload: any, barcodes = [{value:'4680992593610',isPrimary:false},{value:'2049135244192',isPrimary:true}]) {
  const row = {id:'m',clientId:'c',boxId:'b',sourceDocument:'doc',idempotencyKey:'op',createdAt:new Date('2026-10-13'),quantity:1,sku:{name:'item',article:'a',size:'S',barcodes}};
  const db:any = {stockMovement:{findMany:vi.fn().mockResolvedValue([row])},tsdOperation:{findMany:vi.fn().mockResolvedValue(payload ? [{operationKey:'op',operationType:'receipt_scan',status:'ACCEPTED',payload}] : [])}};
  const controller:any = new ReceiptChannelsController(db,{} as any,{} as any);
  controller.readReceipt=async()=>({date:'2026-10-13',boxes:[{id:'b',code:'BOX',receiptDocument:'doc'}]});
  let bytes:any;await controller.file({},'c','w','id',{setHeader(){},send(v:any){bytes=v;}});
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);
  return {value:workbook.worksheets[0].getCell('F2').value,db};
}
it('exports the actual receipt barcode instead of GTIN or changed primary',async()=>{
  expect((await exportBarcode({clientId:'c',boxCode:'BOX',sourceDocument:'doc',barcode:'2049135244192'},[{value:'4680992593610',isPrimary:true}])).value).toBe('2049135244192');
});
it('uses the unique primary for old receipts without a scan',async()=>{
  expect((await exportBarcode(null)).value).toBe('2049135244192');
});
it.each([{clientId:'other',boxCode:'BOX',sourceDocument:'doc'},{clientId:'c',boxCode:'other',sourceDocument:'doc'},{clientId:'c',boxCode:'BOX',sourceDocument:'other'}])('does not use an unrelated operation %j',async(scope)=>{
  expect((await exportBarcode({...scope,barcode:'WRONG'})).value).toBe('2049135244192');
});
it('does not guess between ambiguous legacy barcodes',async()=>{
  expect((await exportBarcode(null,[{value:'111',isPrimary:false},{value:'222',isPrimary:false}])).value).toBe('');
});
