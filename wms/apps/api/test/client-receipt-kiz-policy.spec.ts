import {afterEach,expect,it,vi} from 'vitest';
import {clientReceiptMarking,assertClientReceiptKiz} from '../src/common/client-receipt-kiz-policy';
const db=()=>({systemSetting:{findUnique:vi.fn().mockResolvedValue({value:{required:true}})}});
afterEach(()=>vi.unstubAllEnvs());
it('forces marking for a newly created client SKU, including an unmarked import',async()=>{
 // TEST: new marketplace/manual cards previously defaulted to false.
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');
 expect({...{needsChestnyZnak:false,isUnmarked:true},...await clientReceiptMarking(db(),'kubrin')}).toEqual({needsChestnyZnak:true,isUnmarked:false});
});
it('rejects receipt without KIZ even before a SKU exists',async()=>{
 // TEST: unknown barcode must not bypass the client requirement.
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');
 await expect(assertClientReceiptKiz(db(),'kubrin','')).rejects.toThrow();
 await expect(assertClientReceiptKiz(db(),'kubrin','010460000000000121serial')).resolves.toBeUndefined();
});
it('preserves other clients and sold installations without the explicit policy',async()=>{
 const d=db();expect(await clientReceiptMarking(d,'other')).toEqual({});expect(d.systemSetting.findUnique).not.toHaveBeenCalled();
 vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');d.systemSetting.findUnique.mockResolvedValue(null as any);
 expect(await clientReceiptMarking(d,'other')).toEqual({});
});
