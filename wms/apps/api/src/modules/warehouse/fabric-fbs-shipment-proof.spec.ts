import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFabricShipmentProof } from './fabric-fbs-shipment-proof';
import { reserveFabricOrder, confirmFabricOrderCut } from './fabric-fbs-order';

afterEach(()=>vi.unstubAllEnvs());
function productionFixture() {
  vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED','true');
  const task={id:'t',clientId:'c',requestId:'r',marketplace:'OZON',connectionId:'shop',orderId:'order',status:'COMPLETED',sourceArticle:'__FABRIC_FBS__'};
  const line={lineId:'i',skuId:'s',warehouseId:'w',material:'SATIN',color:'white',lengthMm:3000,units:1};
  const reserved=reserveFabricOrder({rolls:[{id:'roll',warehouseId:'w',material:'SATIN',color:'white',remainingMm:10000,cutMm:0,createdAt:'2026-11-05'}]},task,[line]);
  const ledger=confirmFabricOrderCut(reserved,task,'i',1,'op').state;
  const proof={...task,taskId:'t',key:'op',lineId:'i',skuId:'s',warehouseId:'w',units:1,mm:3000,movementKey:'fbs-sticker-pick:t:fabric:op'};
  const movement={id:'m',clientId:'c',sourceDocument:'r',skuId:'s',warehouseId:'w',status:'PACKING',quantity:1,boxId:null,palletId:null};
  const db={fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([task])},auditLog:{findMany:vi.fn().mockResolvedValue([{payload:proof}])},
    systemSetting:{findUnique:vi.fn().mockResolvedValue({value:ledger})},stockMovement:{findUnique:vi.fn().mockResolvedValue(movement)}};
  return {db,proof,movement,request:{id:'r',clientId:'c',items:[{id:'i',skuId:'s',quantity:1}]}};
}

describe('fabric shipment ownership', () => {
  // TEST: only a fully manufactured, order-owned PACKING credit is shipment evidence.
  it('accepts exact production evidence without demanding AVAILABLE stock',async()=>{
    const f=productionFixture();
    expect(await readFabricShipmentProof(f.db,f.request,'w',new Set(['t']))).toEqual([
      {itemId:'i',skuId:'s',warehouseId:'w',boxId:null,palletId:null,quantity:1,movementIds:['m'],strictPacking:true},
    ]);
  });
  it.each(['wrong-order','wrong-shop','wrong-warehouse','missing-movement','wrong-stock-status','wrong-quantity','overproduction'])('rejects invalid production evidence: %s',async mode=>{
    const f=productionFixture();
    if(mode==='wrong-order')f.proof.orderId='other';
    if(mode==='wrong-shop')f.proof.connectionId='other';
    if(mode==='wrong-warehouse')f.movement.warehouseId='other';
    if(mode==='missing-movement')f.db.stockMovement.findUnique.mockResolvedValue(null);
    if(mode==='wrong-stock-status')f.movement.status='AVAILABLE';
    if(mode==='wrong-quantity')f.movement.quantity=2;
    if(mode==='overproduction')f.request.items[0].quantity=0;
    await expect(readFabricShipmentProof(f.db,f.request,'w',new Set(['t']))).rejects.toThrow();
  });
  // TEST: a WB shipment already recorded must not grant credit again at request close.
  it('does not read production for an empty set of unshipped tasks', async () => {
    const db = { fbsTsdAssembly: { findMany: vi.fn() } };
    expect(await readFabricShipmentProof(db, {id:'r',clientId:'c'}, 'w', new Set())).toEqual([]);
    expect(db.fbsTsdAssembly.findMany).not.toHaveBeenCalled();
  });
  // TEST: another pending task for the same request does not re-enable a shipped task.
  it('excludes a shipped task even when another task remains', async () => {
    const db = {
      fbsTsdAssembly: {findMany:vi.fn().mockResolvedValue([{id:'shipped',status:'COMPLETED',sourceArticle:'__FABRIC_FBS__'}])},
      auditLog: {findMany:vi.fn().mockResolvedValue([{payload:{taskId:'shipped',units:1}}])},
      systemSetting: {findUnique:vi.fn()},
      stockMovement: {findUnique:vi.fn()},
    };
    expect(await readFabricShipmentProof(db, {id:'r',clientId:'c'}, 'w', new Set(['pending']))).toEqual([]);
    expect(db.systemSetting.findUnique).not.toHaveBeenCalled();
    expect(db.stockMovement.findUnique).not.toHaveBeenCalled();
  });
});
