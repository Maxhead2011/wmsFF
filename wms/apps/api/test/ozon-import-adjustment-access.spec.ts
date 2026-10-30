import {afterEach,expect,it,vi} from 'vitest';
import {ClientScopeService} from '../src/modules/auth/client-scope.service';
import {OzonStockAdjustmentService} from '../src/modules/tsd/ozon-stock-adjustment.service';
import {OzonAssemblySupplyService} from '../src/modules/client-requests/ozon-assembly-supply.service';
import {OzonStockAdjustmentController} from '../src/modules/tsd/ozon-stock-adjustment.controller';
import {REQUIRED_PERMISSIONS_KEY} from '../src/modules/auth/decorators/require-permissions.decorator';
afterEach(()=>vi.unstubAllEnvs());
// TEST: imported customer requests have a persisted branch but no internal active branch selector.
for(const kind of ['adjustment','binding'])it(`${kind}: customer own branch allowed, unrelated/read-only client denied`,async()=>{
 vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');
 const db:any={ozonFboShipment:{findUnique:vi.fn(async()=>({request:{clientId:'c',warehouseId:'w'},integration:null}))}};
 const user:any={id:'u',roleCodes:['CLIENT'],permissionCodes:[],activeWarehouseId:null,clientScopeMode:'LIMITED',clientIds:['c'],writableClientIds:['c']};
 const service:any=kind==='adjustment'?new OzonStockAdjustmentService(db,new ClientScopeService(),{} as any,{} as any):new OzonAssemblySupplyService(db,new ClientScopeService());
 const load=(u:any)=>kind==='adjustment'?service.load(db,'r',u):service.load('r',u,'write',db);
 expect((await load(user)).request.warehouseId).toBe('w');
 await expect(load({...user,writableClientIds:[]})).rejects.toThrow();
 await expect(load({...user,clientIds:['other'],writableClientIds:['other']})).rejects.toThrow();
 await expect(load({...user,roleCodes:['BRANCH_MANAGER'],activeWarehouseId:'other',warehouseIds:['other'],writableWarehouseIds:['other']})).rejects.toThrow();
 if(kind==='adjustment')await expect(load({...user,roleCodes:['STAFF'],activeWarehouseId:'w'})).rejects.toThrow('Нет права');
});
it('requires request-write permission at the endpoint without granting general stock-write to customers',()=>{
 expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY,OzonStockAdjustmentController)).toEqual(['client-requests:write']);
});
