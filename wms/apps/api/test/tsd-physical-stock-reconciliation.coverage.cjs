// TEST: native coverage of the compiled safety policy, without adding a coverage dependency.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readPhysicalStockRecovery, physicalStockRecoveryEnabled } = require('../dist/modules/stock/tsd-physical-stock-reconciliation');
const identity = { gtin: '04600000000001', serial: 'SERIAL-00001' };
const value = `01${identity.gtin}21${identity.serial}`;
function fixture() {
  const mark = { id:'mark', clientId:'c', skuId:'s', boxId:'b', status:'AVAILABLE', value };
  const db = {
    productMark: { findMany: async () => [mark] }, box: { findUnique: async () => ({ id:'old',code:'OLD',clientId:'c',warehouseId:'w' }) },
    stockBalance: { findFirst: async () => null }, stockMovement: { findUnique: async () => null },
    ...Object.fromEntries(['fbsTsdAssembly','shippedKizHistory','fbsWebKizStickerPrint','fbsPrintJob','fbsAssemblyAttemptHistory','kizCirculationItem'].map(key => [key,{findFirst:async()=>null}]))
  };
  const input = { source:{id:'b',code:'BOX',clientId:'c',warehouseId:'w',status:'active',palletId:null},skuId:'s',scanCode:value };
  return { mark, db, input, run: () => readPhysicalStockRecovery(db,input,raw => raw===value ? identity : null) };
}
test('feature is explicitly opt-in',()=>{
  const old=process.env.WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED;
  try {delete process.env.WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED;assert.equal(physicalStockRecoveryEnabled(),false);
    process.env.WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED='true';assert.equal(physicalStockRecoveryEnabled(),true);
  }finally{if(old===undefined)delete process.env.WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED;else process.env.WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED=old;}
});
test('one known mark or one new identity',async()=>{
  const f=fixture(); assert.equal((await f.run()).mark.id,'mark');
  f.db.productMark.findMany=async()=>[];assert.equal((await f.run()).mark,null);
});
test('invalid source and identity fail closed',async()=>{
  for(const field of ['warehouseId','status','scanCode']){const f=fixture();if(field==='scanCode')f.input.scanCode='bad';else f.input.source[field]=field==='status'?'deleted':null;await assert.rejects(f.run);}
});
test('duplicate and malformed persisted identity',async()=>{
  const f=fixture();f.db.productMark.findMany=async()=>[f.mark,f.mark];await assert.rejects(f.run);
  f.db.productMark.findMany=async()=>[{...f.mark,value:'invalid'}];await assert.rejects(f.run);
  await assert.rejects(()=>readPhysicalStockRecovery(f.db,f.input,raw=>raw===value?identity:{...identity,serial:'OTHER'}));
});
test('client/SKU/status and repeat-restore restrictions',async()=>{
  for(const field of ['clientId','skuId','status']){const f=fixture();f.mark[field]='other';await assert.rejects(f.run);}
  const f=fixture();f.db.stockMovement.findUnique=async()=>({id:'prior'});await assert.rejects(f.run);
});
test('all histories and nonzero balances remain blocking',async()=>{
  for(const key of ['fbsTsdAssembly','shippedKizHistory','fbsWebKizStickerPrint','fbsPrintJob','fbsAssemblyAttemptHistory','kizCirculationItem','stockBalance']) {
    const f=fixture(); f.db[key].findFirst=async()=>({id:'conflict'});await assert.rejects(f.run);
  }
});
test('old-box ownership and stock',async()=>{
  const good=fixture();good.mark.boxId='old';assert.equal((await good.run()).previousBoxCode,'OLD');
  for(const fault of ['orphan','missing','client','warehouse','balance','task']) {
    const f=fixture();f.mark.boxId=fault==='orphan'?null:'old';
    if(fault==='missing')f.db.box.findUnique=async()=>null;
    if(['client','warehouse'].includes(fault))f.db.box.findUnique=async()=>({id:'old',clientId:fault==='client'?'other':'c',warehouseId:fault==='warehouse'?'other':'w'});
    if(fault==='balance')f.db.stockBalance.findFirst=async({where})=>where.boxId==='old'?{id:'held'}:null;
    if(fault==='task'){let calls=0;f.db.fbsTsdAssembly.findFirst=async()=>++calls===1?null:{id:'active'};}
    await assert.rejects(f.run);
  }
});
