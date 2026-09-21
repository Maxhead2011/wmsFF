import { afterEach, describe, expect, it, vi } from 'vitest';
import { WbStockConfirmationService, confirmationRow } from '../src/modules/marketplace-connections/wb-stock-confirmation.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
const user:any={roleCodes:['CLIENT'],permissionCodes:['clients:read'],clientIds:['client'],writableClientIds:[],clientScopeMode:'LIMITED'};
function fixture(){
 vi.stubEnv('WMS_WB_STOCK_CONFIRMATION_ENABLED','true');vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS','true');
 const db:any={clientMarketplaceConnection:{findFirst:vi.fn().mockResolvedValue({id:'wb',accountName:'WB',fbsExecutionWarehouseId:'warehouse'})},$queryRaw:vi.fn()};
 db.$transaction=vi.fn(fn=>fn(db));
 db.$queryRaw.mockResolvedValueOnce([{total:1,confirmed:0,mismatches:0,unconfirmed:1,pending:0,lastCheckedAt:null}]).mockResolvedValueOnce([{total:1}])
 .mockResolvedValueOnce([{id:'r',chrtId:9007199254740993n,calculatedAmount:4,sentAmount:4,observedAmount:null,status:'UNCONFIRMED'}]).mockResolvedValueOnce([{id:'w',name:'Москва',total:1}]);
 return {db,service:new WbStockConfirmationService(db,new ClientScopeService())};
}
afterEach(()=>vi.unstubAllEnvs());
describe('WB confirmation read model',()=>{
 // TEST: absent WB stock must never become a reassuring zero or lose chrtId precision.
 it('preserves missing observations and large IDs',()=>{expect(confirmationRow({chrtId:9007199254740993n,calculatedAmount:4,observedAmount:null})).toMatchObject({chrtId:'9007199254740993',observedAmount:null,difference:null});expect(confirmationRow({chrtId:1n,calculatedAmount:4,observedAmount:0}).difference).toBe(-4);});
 it('reads one scoped snapshot with pagination and no marketplace requests',async()=>{
  const f=fixture();const result=await f.service.list({clientId:'client',connectionId:'wb',page:'2',status:'UNCONFIRMED',search:'001'},user);
  expect(result.rows[0]).toMatchObject({chrtId:'9007199254740993',observedAmount:null,difference:null});expect(result.page).toBe(2);
  expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'RepeatableRead'});
  for(const [sql] of f.db.$queryRaw.mock.calls){expect(sql.values).toContain('client');expect(sql.values).toContain('wb');}
  expect(f.db.$queryRaw.mock.calls[2][0].values).toContain(50);
 });
 it('blocks another client before database access',async()=>{const f=fixture();await expect(f.service.list({clientId:'other',connectionId:'wb'},user)).rejects.toThrow();expect(f.db.clientMarketplaceConnection.findFirst).not.toHaveBeenCalled();});
 it('rejects a cabinet outside this client and an employee in another warehouse',async()=>{
  const f=fixture();f.db.clientMarketplaceConnection.findFirst.mockResolvedValueOnce(null);await expect(f.service.list({clientId:'client',connectionId:'wb'},user)).rejects.toThrow('не найден');
  await expect(f.service.list({clientId:'client',connectionId:'wb'},{...user,roleCodes:['MANAGER'],activeWarehouseId:'other'})).rejects.toThrow('филиал');expect(f.db.$queryRaw).not.toHaveBeenCalled();
 });
 it('keeps the feature off on the sold VM',async()=>{const f=fixture();vi.stubEnv('WMS_WB_STOCK_CONFIRMATION_ENABLED','false');expect(f.service.capabilities().enabled).toBe(false);await expect(f.service.list({clientId:'client',connectionId:'wb'},user)).rejects.toThrow('недоступно');expect(f.db.$queryRaw).not.toHaveBeenCalled();});
 it.each([{page:'-1'},{page:'1.5'},{status:'INVALID'},{clientId:['client']}])('validates untrusted query input %j',async extra=>{const f=fixture();await expect(f.service.list({clientId:'client',connectionId:'wb',...extra} as any,user)).rejects.toThrow('параметры');expect(f.db.$queryRaw).not.toHaveBeenCalled();});
});
