import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { receiptKizRows, appendReceiptKizSheet } from '../src/modules/warehouse/receipt-kiz-export';
import { ReceiptChannelsController } from '../src/modules/warehouse/receipt-channels.controller';
const kiz='0104640684265324215Z6.hY?E8(=:J\u001d91EE12\u001d92abc=';
const movement=()=>({id:'m',type:'RECEIPT',clientId:'c',warehouseId:'w',skuId:'s',boxId:'b',box:{code:'BOX'},idempotencyKey:'op',sourceDocument:'doc',createdAt:new Date('2026-11-13T10:00:00Z'),quantity:2,productMarks:[],sku:{name:'Товар',article:'Артикул',size:'52',barcodes:[{value:'000123',isPrimary:true}]}});
const db=(payload:any)=>({tsdOperation:{findMany:vi.fn(async(_q:any)=>payload?[{operationKey:'op',payload}]:[])}});
afterEach(()=>vi.unstubAllEnvs());
// TEST: exact receipt evidence survives moves; no stock or billing write adapter exists.
it('restores receipt binding after mark movement',async()=>{const store=db({clientId:'c',warehouseId:'w',boxCode:'BOX',skuId:'s',sourceDocument:'doc',kiz,barcode:'000456'});const rows=await receiptKizRows(store,[movement()]);expect(rows[0].slice(2,8)).toEqual(['BOX','Товар','Артикул','52','000456',kiz]);expect(rows[0][8]).toContain('история');expect(store.tsdOperation.findMany.mock.calls[0][0].where).toMatchObject({status:'ACCEPTED',operationType:'receipt_scan',operationKey:{in:['op']}})});
it.each([{clientId:'foreign'},{warehouseId:'foreign'},{boxCode:'foreign'},{sourceDocument:'foreign'},{skuId:'foreign'}])('rejects foreign scan evidence %j',async(diff)=>{const rows=await receiptKizRows(db({clientId:'c',warehouseId:'w',boxCode:'BOX',sourceDocument:'doc',skuId:'s',kiz,...diff}),[movement()]);expect(rows[0][7]).toBe('')});
it('deduplicates evidence for each mark',async()=>{const row:any=movement();row.productMarks=[{value:kiz},{value:kiz},{value:'other'}];const rows=await receiptKizRows(db({clientId:'c',boxCode:'BOX',sourceDocument:'doc',kiz}),[row]);expect(rows.map(r=>r[7])).toEqual([kiz,'other'])});
it('supports boxless rows without inventing codes',async()=>{const row=movement();Object.assign(row,{boxId:null,box:null,idempotencyKey:null});const rows=await receiptKizRows(db(null),[row]);expect(rows[0][2]).toBe('');expect(rows[0][7]).toBe('')});
it('marks corrected quantities without creating new received units',async()=>{const row:any=movement();row.productMarks=[{value:kiz}];const rows=await receiptKizRows(db(null),[row,{...row,id:'adj',type:'INVENTORY_ADJUSTMENT',quantity:-1}]);expect(rows).toHaveLength(1);expect(rows[0][9]).toContain('корректировалось')});
it('preserves totals, leading zeros and full codes in XLSX',async()=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Количество'],[2]]),'Приёмка');const content=appendReceiptKizSheet(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),await receiptKizRows(db(null),[{...movement(),productMarks:[{value:kiz}]}]));const out=XLSX.read(content,{type:'buffer'});expect(out.Sheets['Приёмка'].A2.v).toBe(2);expect(out.Sheets['КИЗ по товарам'].H2.v).toBe(kiz);expect(out.Sheets['КИЗ по товарам'].G2).toMatchObject({t:'s',v:'000123'})});
it('adds the sheet in the real controller only with own flag',async()=>{const row:any=movement();row.productMarks=[{value:kiz}];const store:any={...db(null),stockMovement:{findMany:async()=>[row]}};const controller:any=new ReceiptChannelsController(store,{} as any,{} as any);controller.readReceipt=async()=>({date:'2026-11-13',boxes:[{id:'b',code:'BOX',receiptDocument:'doc'}]});for(const enabled of [false,true]){vi.stubEnv('WMS_RECEIPT_KIZ_EXPORT_ENABLED',String(enabled));let bytes:any;await controller.file({},'c','w','id',{setHeader(){},send(b:any){bytes=b}});const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);expect(book.getWorksheet('Приёмка')!.getCell('G2').value).toBe(2);expect(!!book.getWorksheet('КИЗ по товарам')).toBe(enabled);if(enabled)expect(XLSX.read(bytes,{type:'buffer'}).Sheets['КИЗ по товарам'].H2.v).toBe(kiz)}});

import { TurnoverService } from '../src/modules/turnover/turnover.service';
// TEST: all client download paths retain the same exact evidence and access guard.
it('exports KIZ for a period and an individual receipt after movement', async () => {
  vi.stubEnv('WMS_RECEIPT_KIZ_EXPORT_ENABLED','true');
  const row:any={...movement(),status:'AVAILABLE',client:{id:'c',code:'CLIENT',name:'Клиент'}};
  row.sku.internalSku='SKU';
  const store:any={...db({clientId:'c',warehouseId:'w',boxCode:'BOX',skuId:'s',sourceDocument:'doc',kiz}),client:{findUnique:async()=>row.client},stockMovement:{findFirst:async()=>row,findMany:async()=>[row]}};
  const scopes:any={requireClientAccess:vi.fn(),resolveClientFilter:()=> 'c'};
  const service=new TurnoverService(store,scopes);
  const user:any={roleCodes:['ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[]};
  for(const file of [await service.getReceiptPeriodXlsx({clientId:'c'},user),await service.getReceiptDocumentXlsx('m',user)]){
    const book=XLSX.read(file.content,{type:'buffer'});
    expect(book.Sheets['КИЗ по товарам'].H2.v).toBe(kiz);
    expect(book.Sheets['КИЗ по товарам'].C2.v).toBe('BOX');
  }
  expect(scopes.requireClientAccess).toHaveBeenCalledWith(user,'c','read');
});
it('denies an unauthorized client before reading KIZ history', async () => {
  vi.stubEnv('WMS_RECEIPT_KIZ_EXPORT_ENABLED','true');
  const store:any=db(null);
  const service=new TurnoverService(store,{requireClientAccess:()=>{throw new Error('denied')}} as any);
  await expect(service.getReceiptPeriodXlsx({clientId:'foreign'},{} as any)).rejects.toThrow('denied');
  expect(store.tsdOperation.findMany).not.toHaveBeenCalled();
});
