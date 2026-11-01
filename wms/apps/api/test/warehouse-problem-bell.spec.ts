import {expect,it,vi} from 'vitest';
import {InventoryService} from '../src/modules/inventory/inventory.service';
import {ClientScopeService} from '../src/modules/auth/client-scope.service';
function setup(){
 const db={client:{findMany:vi.fn().mockResolvedValue([{id:'c',name:'Клиент'}])},inventorySession:{findMany:vi.fn().mockResolvedValue([{id:'s',clientId:'c',title:'Нет короба',createdByName:'Сборщик',comment:'[FBO_MISSING_PALLET_BOX] Короб: 7; палет-сорт: 2',createdAt:new Date()}])}};
 return {db,service:new InventoryService(db as never,new ClientScopeService(),{} as never)};
}
const user={roleCodes:['OWNER'],permissionCodes:['system:admin'],activeWarehouseId:'wh',warehouseIds:['wh'],clientScopeMode:'ALL'};
it('includes both marketplaces in the selected branch for owners and administrators',async()=>{
 for(const role of ['OWNER','ADMIN']){
  const {db,service}=setup();
  const rows=await service.warehouseProblems({...user,roleCodes:[role]} as never);
  expect(rows[0]).toMatchObject({client:'Клиент',worker:'Сборщик',detail:'Короб: 7; палет-сорт: 2'});
  expect(db.inventorySession.findMany.mock.calls[0][0].where).toMatchObject({warehouseId:'wh',clientId:{in:['c']},status:{in:['ACTIVE','REVIEW']},OR:expect.arrayContaining([{comment:{startsWith:'[FBS_MISSING_PALLET_BOX]'}},{comment:{startsWith:'[FBO_MISSING_PALLET_BOX]'}}])});
 }
});
it('rejects a manager before reading signals',async()=>{
 const {db,service}=setup();
 await expect(service.warehouseProblems({...user,roleCodes:['MANAGER']} as never)).rejects.toThrow();
 expect(db.inventorySession.findMany).not.toHaveBeenCalled();
});
