import 'reflect-metadata';
import {expect,it,vi} from 'vitest';
import ExcelJS from 'exceljs';
import {ReceiptChannelsController} from '../src/modules/warehouse/receipt-channels.controller';
// TEST: verify the actual XLSX, not just the report counter.
it('exports recovered assigned units alongside ordinary receipts exactly once',async()=>{
 const controller:any=Object.create(ReceiptChannelsController.prototype);
 controller.readReceipt=async()=>({date:'2026-10-31',boxes:[{id:'ordinary',code:'BOX_001',receiptDocument:'receipt'},{id:'recovered',code:'BOX_007',receiptDocument:'opening',recoveredMovementIds:['fix1','fix2','fix3']}]});
 const sku={name:'Dress',article:'dress',size:'50',barcodes:[{value:'4610389211223',isPrimary:true}]};
 const rows=[{id:'original',boxId:'ordinary',quantity:2104},...[5,22,5].map((quantity,i)=>({id:'fix'+(i+1),boxId:'recovered',quantity}))].map(r=>({...r,sku,clientId:'c',sourceDocument:'receipt',idempotencyKey:null,createdAt:new Date('2026-10-31T12:00:00Z')}));
 controller.prisma={stockMovement:{findMany:vi.fn(async({where}:any)=>rows.filter(r=>r.id==='original'||where.OR?.some((clause:any)=>clause.id?.in?.includes(r.id))))}};
 let buffer:any;const response:any={setHeader:vi.fn(),send:(b:any)=>buffer=b};
 await controller.file({} as any,'c','w','receipt',response);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
 const sheet=workbook.worksheets[0];let total=0;sheet.eachRow((row,n)=>{if(n>1)total+=Number(row.getCell(7).value)});
 expect(total).toBe(2136);expect(sheet.rowCount).toBe(5);
});
