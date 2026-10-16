// TEST: actual container runtime and native XLSX export, without database writes.
require('reflect-metadata');
const assert=require('assert/strict'),ExcelJS=require('exceljs');
const {ReceiptChannelsController}=require('/app/apps/api/dist/modules/warehouse/receipt-channels.controller');
const {receiptExportBarcodes}=require('/app/apps/api/dist/modules/warehouse/receipt-export-barcode');
async function exported(scan,barcodes){
 const row={id:'m',clientId:'c',boxId:'b',sourceDocument:'doc',idempotencyKey:'op',createdAt:new Date('2026-10-13'),quantity:1,sku:{name:'item',article:'a',size:'S',barcodes}};
 const db={stockMovement:{findMany:async()=>[row]},tsdOperation:{findMany:async()=>scan?[{operationKey:'op',payload:scan}]:[]}};
 const controller=new ReceiptChannelsController(db,{},{});
 controller.readReceipt=async()=>({date:'2026-10-13',boxes:[{id:'b',code:'BOX',receiptDocument:'doc'}]});
 let bytes;await controller.file({},'c','w','id',{setHeader(){},send(v){bytes=v;}});
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);
 assert.equal(wb.worksheets[0].getCell('G2').value,1);
 return wb.worksheets[0].getCell('F2').value;
}
(async()=>{
 const aliases=[{value:'4680992593610',isPrimary:false},{value:'2049135244192',isPrimary:true}];
 const scan={clientId:'c',boxCode:'BOX',sourceDocument:'doc',barcode:'2049135244192'};
 assert.equal(await exported(scan,[{value:'4680992593610',isPrimary:true}]),scan.barcode);
 assert.equal(await exported(null,aliases),scan.barcode);
 for(const invalid of [{clientId:'other'},{boxCode:'other'},{sourceDocument:'other'}])assert.equal(await exported({...scan,...invalid,barcode:'WRONG'},aliases),scan.barcode);
 assert.equal(await exported(null,[{value:'111',isPrimary:false},{value:'222',isPrimary:false}]),'');
 let count=0;const rows=Array.from({length:1001},(_,i)=>({id:String(i),clientId:'c',boxId:'b',sourceDocument:'doc',idempotencyKey:String(i),sku:{barcodes:aliases}}));
 const result=await receiptExportBarcodes({tsdOperation:{findMany:async q=>{count++;assert.ok(q.where.operationKey.in.length<=500);assert.equal(q.where.status,'ACCEPTED');return [];}}},rows,new Map([['b','BOX']]));
 assert.equal(count,3);assert.equal(result.size,1001);
 console.log(JSON.stringify({passed:true,cases:7}));
})().catch(e=>{console.error(e);process.exit(1)});
