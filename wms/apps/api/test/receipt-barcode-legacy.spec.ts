import {expect,it,vi} from 'vitest';
import {holdLegacyBarcode,consumeLegacyHold} from '../src/modules/tsd/receipt-barcode-legacy';
function fixture(){
 const movement={id:'move',type:'RECEIPT',status:'AVAILABLE',boxId:'box',skuId:'sku',clientId:'c',warehouseId:'w',quantity:1,sourceDocument:'receipt'};
 const balance={...movement,id:'balance',palletId:null};
 const original={id:'original',operationType:'receipt_scan',operationKey:'scan',status:'ACCEPTED',deviceId:'device',createdAt:new Date(),payload:{barcode:'18',clientId:'c',boxCode:'FFL_TEST',quantity:'1'}};
 const tx:any={$queryRaw:vi.fn(),barcode:{findFirst:vi.fn().mockResolvedValue(null)},
 tsdOperation:{findUniqueOrThrow:vi.fn().mockResolvedValue(original),findUnique:vi.fn().mockResolvedValue(null),create:vi.fn(async({data})=>({...data,id:'issue'}))},
 stockMovement:{findUnique:vi.fn().mockResolvedValue(movement),count:vi.fn().mockResolvedValue(0),create:vi.fn()},
 productMark:{count:vi.fn().mockResolvedValue(0)},auditLog:{create:vi.fn()},
 stockBalance:{findMany:vi.fn().mockResolvedValue([balance]),updateMany:vi.fn().mockResolvedValue({count:1}),upsert:vi.fn().mockResolvedValue({id:'held'}),findUniqueOrThrow:vi.fn().mockResolvedValue({...balance,status:'BLOCKED'}),update:vi.fn()}};
 return {tx,movement,balance};
}
// TEST: quarantine keeps the original receipt and total physical quantity, but removes availability.
it('quarantines old receipt once with paired movements',async()=>{
 const f=fixture();const result=await holdLegacyBarcode(f.tx,'original','w','owner');
 expect(f.tx.stockMovement.create.mock.calls.map(c=>c[0].data.quantity)).toEqual([-1,1]);
 expect(f.tx.stockMovement.create.mock.calls.map(c=>c[0].data.status)).toEqual(['AVAILABLE','BLOCKED']);
 expect(result.payload.originalOperationId).toBe('original');expect(result.payload.legacyHeldBalanceId).toBe('held');
 expect(f.tx.auditLog.create).toHaveBeenCalledOnce();
});
it('does not repeat a staged receipt',async()=>{
 const f=fixture();f.tx.tsdOperation.findUnique.mockResolvedValue({id:'existing'});
 expect(await holdLegacyBarcode(f.tx,'original','w','owner')).toEqual({id:'existing'});expect(f.tx.stockBalance.updateMany).not.toHaveBeenCalled();
});
it.each(['movement','mark','balance'])('blocks changed %s before mutation',async what=>{
 const f=fixture();if(what==='movement')f.tx.stockMovement.count.mockResolvedValue(1);if(what==='mark')f.tx.productMark.count.mockResolvedValue(1);if(what==='balance')f.balance.quantity=2;
 await expect(holdLegacyBarcode(f.tx,'original','w','owner')).rejects.toThrow();expect(f.tx.stockBalance.updateMany).not.toHaveBeenCalled();
});
it('consumes the hold without another receipt movement',async()=>{
 const f=fixture();await consumeLegacyHold(f.tx,'held','issue','c','w',1);
 expect(f.tx.stockMovement.create).toHaveBeenCalledWith({data:expect.objectContaining({type:'INVENTORY_ADJUSTMENT',status:'BLOCKED',quantity:-1})});
});
it('does not consume another warehouse hold',async()=>{
 const f=fixture();await expect(consumeLegacyHold(f.tx,'held','issue','c','other',1)).rejects.toThrow();expect(f.tx.stockBalance.update).not.toHaveBeenCalled();
});
