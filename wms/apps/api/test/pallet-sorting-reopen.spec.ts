import { expect, it, vi } from 'vitest';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';

function fixture(){
  const service:any=Object.create(PalletSortingService.prototype);
  service.boxCodes={requireAllowed:vi.fn(async(s:string)=>s.trim().toUpperCase())};
  service.assertUnclaimed=vi.fn();service.assertMovementAllowed=vi.fn();service.audit=vi.fn();
  const box:any={id:'target',code:'TARGET',status:'active',clientId:'client',warehouseId:'wh',storagePlacement:{palletId:'pallet'}};
  const tx:any={$executeRaw:vi.fn(),storagePallet:{findFirst:vi.fn().mockResolvedValue({id:'pallet',code:'PALLET'})},
    box:{findUnique:vi.fn(async()=>box),create:vi.fn()},stockBalance:{count:vi.fn().mockResolvedValue(13),aggregate:vi.fn().mockResolvedValue({_sum:{quantity:13},_min:{quantity:1}})},productMark:{count:vi.fn().mockResolvedValue(13)}};
  const state:any={id:'session',clientId:'client',warehouseId:'wh',stage:'FORMING',sources:[],targets:[{id:'target',code:'TARGET',closed:true,quantity:13,palletCode:'PALLET'}],activeTargetId:null};
  return {service,box,tx,state,user:{id:'admin'},dto:{action:'OPEN_TARGET',code:'TARGET',palletCode:'PALLET'}};
}
it('reopens a closed destination without creating another box or resetting its 13 units',async()=>{
  // TEST: close -> reopen -> close preserves the same target and quantity.
  const f=fixture();await f.service.runAction(f.tx,f.state,f.dto,f.user);
  expect(f.state.targets).toHaveLength(1);expect(f.state.targets[0]).toMatchObject({closed:false,quantity:13});
  expect(f.state.activeTargetId).toBe('target');expect(f.tx.box.create).not.toHaveBeenCalled();
  await f.service.runAction(f.tx,f.state,{action:'CLOSE_TARGET'},f.user);
  expect(f.state.targets[0]).toMatchObject({closed:true,quantity:13});
});
it.each([0,3,13])('opens an existing destination from a completed sorting with %s units',async quantity=>{
  // TEST: a new session can top up FFL_LKBS0709_12 without re-receiving its existing stock.
  const f=fixture();f.state.targets=[];
  f.tx.stockBalance.aggregate.mockResolvedValue({_sum:{quantity:quantity||null},_min:{quantity:quantity||null}});
  await f.service.runAction(f.tx,f.state,f.dto,f.user);
  expect(f.state.targets).toEqual([expect.objectContaining({id:'target',code:'TARGET',closed:false,quantity,palletCode:'PALLET'})]);
  expect(f.state.activeTargetId).toBe('target');
  expect(f.tx.box.create).not.toHaveBeenCalled();
  expect(f.service.assertUnclaimed).toHaveBeenCalledWith(f.tx,['target'],'session','wh');
  expect(f.service.assertMovementAllowed).toHaveBeenCalledWith(f.tx,['target'],f.state,f.user);
  await f.service.runAction(f.tx,f.state,{action:'CLOSE_TARGET'},f.user);
  await f.service.runAction(f.tx,f.state,f.dto,f.user);
  expect(f.state.targets).toHaveLength(1);expect(f.state.targets[0].quantity).toBe(quantity);
});
it.each(['other-open','source','claimed','inventory','negative'])('refuses unsafe existing destination: %s',async kind=>{
  // TEST: top-up cannot bypass ownership, active work or invalid accounting balances.
  const f=fixture();f.state.targets=[];
  if(kind==='foreign-client')f.box.clientId='other';
  if(kind==='foreign-warehouse')f.box.warehouseId='other';
  if(kind==='moved')f.box.storagePlacement.palletId='other';
  if(kind==='archived')f.box.status='archived';
  if(kind==='other-open')f.state.activeTargetId='other';
  if(kind==='source')f.state.sources=[{id:'target',code:'TARGET'}];
  if(kind==='claimed')f.service.assertUnclaimed.mockRejectedValue(new Error('claimed'));
  if(kind==='inventory')f.service.assertMovementAllowed.mockRejectedValue(new Error('inventory'));
  if(kind==='negative')f.tx.stockBalance.aggregate.mockResolvedValue({_sum:{quantity:3},_min:{quantity:-1}});
  await expect(f.service.runAction(f.tx,f.state,f.dto,f.user)).rejects.toThrow();
  expect(f.state.targets).toEqual([]);expect(f.tx.box.create).not.toHaveBeenCalled();
});
it.each(['missing','other-open','source'])('refuses unsafe reopening: %s',async kind=>{
  // TEST: reusing a code never overrides ownership, placement or another active target.
  const f=fixture();
  if(kind==='foreign-client')f.box.clientId='other';
  if(kind==='foreign-warehouse')f.box.warehouseId='other';
  if(kind==='moved')f.box.storagePlacement.palletId='other';
  if(kind==='archived')f.box.status='archived';
  if(kind==='missing')f.tx.box.findUnique.mockResolvedValue(null);
  if(kind==='other-open')f.state.activeTargetId='other';
  if(kind==='source')f.state.sources=[{id:'target',code:'TARGET'}];
  await expect(f.service.runAction(f.tx,f.state,f.dto,f.user)).rejects.toThrow();
  expect(f.state.targets[0].closed).toBe(true);expect(f.tx.box.create).not.toHaveBeenCalled();
});
