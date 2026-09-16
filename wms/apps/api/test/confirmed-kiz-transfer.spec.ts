import { afterEach, expect, it, vi } from 'vitest';
import { debitConfirmedKizSource, inventoryKizTransferWarnings } from '../src/modules/inventory/confirmed-kiz-transfer';
afterEach(() => vi.unstubAllEnvs());
it.each(['reservation','count','movement','zero','blocked','foreign-branch','foreign-client','parallel-update'])('stops an unsafe source transfer: %s', async kind => {
  // TEST: confirmation cannot steal a reservation or invent a negative stock balance.
  vi.stubEnv('WMS_KIZ_IDENTITY_TRANSFER_ENABLED','true');
  const balance = {id:'balance',quantity:kind==='zero'?0:1,status:kind==='blocked'?'RESERVED':'AVAILABLE',clientId:'client',warehouseId:'wh'};
  const tx:any = {box:{findUnique:vi.fn(async()=>({id:'source',code:'177',clientId:kind==='foreign-client'?'other':'client',warehouseId:kind==='foreign-branch'?'other':'wh',status:'active'}))},
    fbsTsdAssembly:{findFirst:vi.fn(async()=>kind==='reservation'?{id:'task'}:null)},
    inventoryAuditBox:{findFirst:vi.fn(async()=>kind==='count'?{id:'count'}:null)},
    stockMovement:{findFirst:vi.fn(async()=>kind==='movement'?{id:'move'}:null),create:vi.fn()},
    stockBalance:{findMany:vi.fn(async()=>[balance]),updateMany:vi.fn(async()=>({count:kind==='parallel-update'?0:1}))}};
  await expect(debitConfirmedKizSource(tx,{mark:{id:'mark',clientId:'client',skuId:'sku',boxId:'source',status:'AVAILABLE'},
    destination:{id:'target',clientId:'client',warehouseId:'wh'},auditId:'audit',startedAt:new Date(),userId:'admin'})).rejects.toThrow('Перенос КИЗ остановлен');
  expect(tx.stockMovement.create).not.toHaveBeenCalled();
  if(kind!=='parallel-update')expect(tx.stockBalance.updateMany).not.toHaveBeenCalled();
});
it('shows the real source and destination before existing administrator confirmation without mutation',async()=>{
  // TEST: preview must expose the source debit to the administrator.
  vi.stubEnv('WMS_KIZ_IDENTITY_TRANSFER_ENABLED','true'); const startedAt=new Date();
  const value='0104680992598455215rYJoe1STv"l%\u001d91EE12\u001d92proof';
  const tx:any={auditLog:{findMany:vi.fn(async()=>[{payload:{boxId:'target',clientId:'client',roundStartedAt:startedAt.toISOString(),kiz:value}}])},
    productMark:{findMany:vi.fn(async()=>[{value:value.replaceAll('\u001d',''),box:{code:'177'}}])}};
  const warnings=await inventoryKizTransferWarnings(tx,{id:'audit',boxId:'target',boxCode:'181',clientId:'client',startedAt});
  expect(warnings).toHaveLength(1);expect(warnings[0]).toContain('177');expect(warnings[0]).toContain('181');expect(warnings[0]).toContain('спишет 1 шт.');
});
