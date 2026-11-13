// TEST: run against the materialized current runtime, not a rebuilt source service.
const assert=require('node:assert/strict'),path=require('node:path');
require('reflect-metadata');
const XLSX=require('xlsx');
const root=process.argv[2];
const {ReceiptChannelsController}=require(path.join(root,'modules/warehouse/receipt-channels.controller.js'));
const {TurnoverService}=require(path.join(root,'modules/turnover/turnover.service.js'));
const kiz='0104640684265324215Z6.hY?E8(=:J\u001d91EE12\u001d92abc=';
const row={id:'m',type:'RECEIPT',clientId:'c',warehouseId:'w',skuId:'s',boxId:'b',box:{id:'b',code:'BOX'},idempotencyKey:'op',sourceDocument:'doc',createdAt:new Date('2026-11-13T10:00:00Z'),quantity:2,status:'AVAILABLE',productMarks:[],sku:{internalSku:'SKU',clientSku:'ARTICLE',name:'Товар',article:'Артикул',size:'52',barcodes:[{value:'000123',isPrimary:true}]},client:{id:'c',code:'CLIENT',name:'Клиент'}};
const db={systemSetting:{findUnique:async()=>null},tsdOperation:{findMany:async()=>[{operationKey:'op',payload:{clientId:'c',warehouseId:'w',boxCode:'BOX',skuId:'s',sourceDocument:'doc',kiz,barcode:'000123'}}]},client:{findUnique:async()=>row.client},stockMovement:{findFirst:async()=>row,findMany:async()=>[row]}};
const scopes={requireClientAccess(){},resolveClientFilter:()=> 'c'};
const user={roleCodes:['ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL',clientIds:[],writableClientIds:[]};
(async()=>{
 const controller=new ReceiptChannelsController(db,scopes,{});controller.readReceipt=async()=>({date:'2026-11-13',boxes:[{id:'b',code:'BOX',receiptDocument:'doc'}]});
 const service=new TurnoverService(db,scopes);
 for(const enabled of [false,true]){
  process.env.WMS_RECEIPT_KIZ_EXPORT_ENABLED=String(enabled);
  let bytes;await controller.file(user,'c','w','id',{setHeader(){},send(b){bytes=b}});
  const files=[bytes,(await service.getReceiptPeriodXlsx({clientId:'c'},user)).content,(await service.getReceiptDocumentXlsx('m',user)).content];
  for(const buffer of files){const book=XLSX.read(buffer,{type:'buffer'});assert.equal(!!book.Sheets['КИЗ по товарам'],enabled);if(enabled){assert.equal(book.Sheets['КИЗ по товарам'].H2.v,kiz);assert.equal(book.Sheets['КИЗ по товарам'].G2.v,'000123')}}
  assert.equal(XLSX.read(bytes).Sheets['Приёмка'].G2.v,2);
 }
 console.log('PASS runtime: all 3 receipt exports, own flag off/on, complete KIZ, quantity unchanged');
})().catch(e=>{console.error(e);process.exit(1)});
