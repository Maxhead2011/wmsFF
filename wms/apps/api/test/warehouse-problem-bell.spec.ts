import {expect,it,vi} from 'vitest';
import {InventoryService} from '../src/modules/inventory/inventory.service';
import {ClientScopeService} from '../src/modules/auth/client-scope.service';
function setup(){
 const db={systemSetting:{findMany:vi.fn().mockResolvedValue([]),upsert:vi.fn()},client:{findMany:vi.fn().mockResolvedValue([{id:'c',name:'Клиент'}])},inventorySession:{findMany:vi.fn().mockResolvedValue([{id:'s',clientId:'c',title:'Нет короба',createdByName:'Сборщик',comment:'[FBO_MISSING_PALLET_BOX] Короб: 7; палет-сорт: 2',createdAt:new Date()}])}};
 return {db,service:new InventoryService(db as never,new ClientScopeService(),{} as never)};
}
const user={id:'admin-1',roleCodes:['OWNER'],permissionCodes:['system:admin'],activeWarehouseId:'wh',warehouseIds:['wh'],clientScopeMode:'ALL'};
it('includes both marketplaces in the selected branch for owners and administrators',async()=>{
 for(const role of ['OWNER','ADMIN']){
  const {db,service}=setup();
  const rows=await service.warehouseProblems({...user,roleCodes:[role]} as never);
  expect(rows[0]).toMatchObject({client:'Клиент',worker:'Сборщик',detail:'Короб: 7; палет-сорт: 2',boxCode:'7',kind:'box',clientId:'c',isRead:false});
  expect(db.inventorySession.findMany.mock.calls[0][0].where).toMatchObject({warehouseId:'wh',clientId:{in:['c']},status:{in:['ACTIVE','REVIEW']},OR:expect.arrayContaining([{comment:{startsWith:'[FBS_MISSING_PALLET_BOX]'}},{comment:{startsWith:'[FBO_MISSING_PALLET_BOX]'}}])});
 }
});
it('rejects a manager before reading signals',async()=>{
 const {db,service}=setup();
 await expect(service.warehouseProblems({...user,roleCodes:['MANAGER']} as never)).rejects.toThrow();
 expect(db.inventorySession.findMany).not.toHaveBeenCalled();
});

it('keeps read state personal and rejects acknowledgement outside the visible list',async()=>{
 const {db,service}=setup();
 await service.readWarehouseProblem('s',user as never);
 expect(db.systemSetting.upsert.mock.calls[0][0].where.key).toBe('warehouse.problem.read.v1:admin-1:s');
 await expect(service.readWarehouseProblem('foreign',user as never)).rejects.toThrow();
 expect(db.systemSetting.upsert).toHaveBeenCalledTimes(1);
 db.systemSetting.findMany.mockResolvedValueOnce([{key:'warehouse.problem.read.v1:admin-1:s'}]);
 expect((await service.warehouseProblems(user as never))[0].isRead).toBe(true);
 expect((await service.warehouseProblems({...user,id:'admin-2'} as never))[0].isRead).toBe(false);
});
it('archives completed or cancelled checks for the branch and open checks read by this user',async()=>{
 const {db,service}=setup();db.systemSetting.findMany.mockResolvedValueOnce([{key:'warehouse.problem.read.v1:admin-1:s'}]);
 await service.warehouseProblems(user as never,true,'previous');
 expect(db.inventorySession.findMany.mock.calls[0][0]).toMatchObject({take:40,skip:1,cursor:{id:'previous'},where:{warehouseId:'wh',clientId:{in:['c']},AND:[{OR:[{status:{in:['COMPLETED','CANCELLED']}},{id:{in:['s']}}]}]}});
});
