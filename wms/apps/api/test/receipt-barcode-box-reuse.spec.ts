import {afterEach,expect,it,vi} from 'vitest';
import {TsdReceiptService} from '../src/modules/tsd/tsd-receipt.service';
afterEach(()=>vi.unstubAllEnvs());
// TEST: physically pending goods must not be treated as an empty reusable receipt box.
it('blocks reuse of a closed box pending barcode review',async()=>{
 vi.stubEnv('WMS_RECEIPT_BARCODE_REVIEW_ENABLED','true');
 const db:any={client:{findFirst:vi.fn().mockResolvedValue({id:'c'})},box:{findUnique:vi.fn().mockResolvedValue({id:'b',code:'FFL_TEST',clientId:'c',warehouseId:'w',status:'active',balances:[]}),update:vi.fn()},tsdOperation:{findFirst:vi.fn().mockResolvedValue({id:'pending'})}};
 const service=new TsdReceiptService(db,{requireClientAccess:vi.fn()} as any,{touchActiveDevice:vi.fn()} as any);
 await expect(service.openBox({clientId:'c',boxCode:'FFL_TEST'},{activeWarehouseId:'w',writableWarehouseIds:['w'],roleCodes:['OPERATOR'],permissionCodes:[]} as any)).rejects.toThrow('проверке ШК');
 expect(db.box.update).not.toHaveBeenCalled();
});
