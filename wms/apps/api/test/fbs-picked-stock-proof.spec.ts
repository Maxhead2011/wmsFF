import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFbsPickedStockProof, subtractPickedQuantities } from '../src/modules/stock/fbs-picked-stock-proof';

// TEST: a completed FBS pick is evidence, not a second request for AVAILABLE stock.
const request = { id: 'r', clientId: 'c', items: [{ id: 'i', skuId: 's', quantity: 1 }] };
function fixture() {
  const task = { id: 'task', requestId: 'r', requestItemId: 'i', clientId: 'c', skuId: 's', boxId: 'b', status: 'COMPLETED', itemCount: 1 };
  const movement = { id: 'pick', clientId: 'c', warehouseId: 'w', skuId: 's', boxId: 'b', palletId: null, status: 'AVAILABLE', quantity: -1, idempotencyKey: 'fbs-sticker-pick:task:balance:out' };
  const db = { fbsTsdAssembly: { findMany: vi.fn(async () => [task]) }, stockMovement: { findMany: vi.fn(async () => [movement]) } };
  return { db, task, movement };
}
describe('FBS picked stock proof', () => {
  afterEach(() => vi.unstubAllEnvs());
  // TEST: relabelled stock removed by a recount has physical evidence but no second pick debit.
  it.each(['valid','disabled','returned-mark','different-mark-sku','remaining-stock','other-task','later-return','missing-relabel','multiple-units'])('validates relabel/recount evidence: %s', async mode => {
    vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED', 'true');
    const f = fixture();
    Object.assign(f.task, {sourceSkuId:'source',relabelConfirmedAt:new Date('2026-09-25T10:00Z'),kiz:'mark'});
    const pair = [
      {...f.movement,id:'source',skuId:'source',idempotencyKey:'fbs-relabel:task:source',type:'INVENTORY_ADJUSTMENT',createdAt:new Date('2026-09-25T10:00Z')},
      {...f.movement,id:'target',quantity:1,idempotencyKey:'fbs-relabel:task:target',type:'INVENTORY_ADJUSTMENT',createdAt:new Date('2026-09-25T10:00Z')},
    ];
    const ledger = [
      {...f.movement,id:'target',quantity:1,idempotencyKey:'fbs-relabel:task:target',type:'INVENTORY_ADJUSTMENT'},
      {...f.movement,id:'recount',quantity:-1,idempotencyKey:'web-inventory:count',type:'INVENTORY_ADJUSTMENT'},
    ];
    if(mode==='disabled') vi.stubEnv('WMS_PERMANENT_STORAGE_BOXES_ENABLED','false');
    if(mode==='multiple-units') f.task.itemCount=2;
    if(mode==='missing-relabel') pair.pop();
    if(mode==='later-return') ledger.push({...ledger[1],id:'return',quantity:1});
    f.db.stockMovement.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(pair).mockResolvedValueOnce(ledger);
    Object.assign(f.db, {productMark:{findMany:vi.fn(async()=>[{value:'mark',status:'PACKING',skuId:'s',boxId:'b'}])},
      stockBalance:{findMany:vi.fn(async()=>[])}});
    if(mode==='returned-mark') (f.db as any).productMark.findMany.mockResolvedValue([{value:'mark',status:'AVAILABLE',skuId:'s',boxId:'b'}]);
    if(mode==='different-mark-sku') (f.db as any).productMark.findMany.mockResolvedValue([{value:'mark',status:'PACKING',skuId:'other',boxId:'b'}]);
    if(mode==='remaining-stock') (f.db as any).stockBalance.findMany.mockResolvedValue([{quantity:1}]);
    f.db.fbsTsdAssembly.findMany.mockResolvedValueOnce([f.task]).mockResolvedValueOnce(mode==='other-task'?[f.task,{...f.task,id:'other'}]:[f.task]);
    const result=await readFbsPickedStockProof(f.db as any,request,'w');
    if(mode==='valid') expect(result).toMatchObject([{itemId:'i',quantity:1,boxId:'b',movementIds:['source','target','recount']}]);
    else expect(result).toEqual([]);
  });
  it('finds an exact task pick even after request transfer changed sourceDocument', async () => {
    const f = fixture();
    await expect(readFbsPickedStockProof(f.db as any, request, 'w')).resolves.toMatchObject([{ itemId: 'i', skuId: 's', boxId: 'b', quantity: 1, movementIds: ['pick'] }]);
  });
  it('nets a cancelled pick against its AVAILABLE return', async () => {
    const f = fixture();
    f.db.stockMovement.findMany.mockResolvedValue([f.movement, { ...f.movement, id: 'return', quantity: 1, idempotencyKey: 'fbs-sticker-pick:task:return:in' }]);
    expect(await readFbsPickedStockProof(f.db as any, request, 'w')).toEqual([]);
  });
  it.each(['clientId','warehouseId','skuId','idempotencyKey'])('does not trust a different %s', async field => {
    const f = fixture();
    (f.movement as any)[field] = 'other';
    expect(await readFbsPickedStockProof(f.db as any, request, 'w')).toEqual([]);
  });
  it('does not treat a completed task without ledger movement as a pick', async () => {
    const f = fixture(); f.db.stockMovement.findMany.mockResolvedValue([]);
    expect(await readFbsPickedStockProof(f.db as any, request, 'w')).toEqual([]);
  });
  // TEST: returns may be received into a different box; they still cancel the pick.
  it('nets a return into another box', async()=>{
    const f=fixture();
    f.db.stockMovement.findMany.mockResolvedValue([f.movement,{...f.movement,id:'return',boxId:'new-box',quantity:1,idempotencyKey:'fbs-sticker-pick:task:return:in'}]);
    expect(await readFbsPickedStockProof(f.db as any,request,'w')).toEqual([]);
  });
  it('keeps only unpicked quantities in remaining source plans', () => {
    expect(subtractPickedQuantities([{ requestItemId: 'i', boxId:'a', quantity:1 },{ requestItemId:'i', boxId:'b', quantity:2 }],
      [{itemId:'i',boxId:'b',quantity:1}])).toEqual([{requestItemId:'i',boxId:'a',quantity:1},{requestItemId:'i',boxId:'b',quantity:1}]);
  });
});
