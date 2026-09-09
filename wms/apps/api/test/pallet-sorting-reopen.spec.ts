import { expect, it, vi } from 'vitest';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';

function fixture(){
  const service:any=Object.create(PalletSortingService.prototype);
  service.boxCodes={requireAllowed:vi.fn(async(s:string)=>s.trim().toUpperCase())};
  service.assertUnclaimed=vi.fn();service.assertMovementAllowed=vi.fn();service.audit=vi.fn();
  const box:any={id:'target',code:'TARGET',status:'active',clientId:'client',warehouseId:'wh',storagePlacement:{palletId:'pallet'}};
  const tx:any={$executeRaw:vi.fn(),storagePallet:{findFirst:vi.fn().mockResolvedValue({id:'pallet',code:'PALLET'})},
    box:{findUnique:vi.fn(async()=>box),create:vi.fn()},stockBalance:{count:vi.fn().mockResolvedValue(13)},productMark:{count:vi.fn().mockResolvedValue(13)}};
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
it.each(['foreign-client','foreign-warehouse','moved','archived','missing','other-open','source'])('refuses unsafe reopening: %s',async kind=>{
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
