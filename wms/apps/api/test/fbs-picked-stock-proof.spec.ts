import { describe, it, expect, vi } from 'vitest';
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
