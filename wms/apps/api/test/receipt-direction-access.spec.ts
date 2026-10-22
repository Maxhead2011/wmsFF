import { afterEach, expect, it, vi } from 'vitest';
import { canManageReceiptDirections } from '../src/modules/warehouse/receipt-direction-access';
const user:any={id:'svetlana',roleCodes:['CLIENT'],writableClientIds:['lukin'],permissionCodes:[],isDemo:false};
const db:any={systemSetting:{findUnique:vi.fn(async()=>({value:{enabled:true,userId:'svetlana',clientId:'lukin'}}))}};
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
// TEST: every client manager with writable scope can manage directions without a per-user grant.
it('allows a client manager without warehouse administrator rights',async()=>{vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');expect(await canManageReceiptDirections(db,user,'lukin')).toBe(true);});
it('rejects another client and read-only access before loading a grant',async()=>{vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');expect(await canManageReceiptDirections(db,user,'other')).toBe(false);expect(await canManageReceiptDirections(db,{...user,writableClientIds:[]},'lukin')).toBe(false);expect(db.systemSetting.findUnique).not.toHaveBeenCalled();});
it('allows another manager with the same writable scope without a personal grant',async()=>{vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');expect(await canManageReceiptDirections(db,{...user,id:'other'},'lukin')).toBe(true);expect(db.systemSetting.findUnique).not.toHaveBeenCalled();});
it('rejects demo and disabled installations',async()=>{vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','false');expect(await canManageReceiptDirections(db,user,'lukin')).toBe(false);vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');expect(await canManageReceiptDirections(db,{...user,isDemo:true},'lukin')).toBe(false);});
it('does not give operators delegated client access',async()=>{vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');expect(await canManageReceiptDirections(db,{...user,roleCodes:['TSD']},'lukin')).toBe(false);});
it('preserves administrator permission requirements',async()=>{vi.stubEnv('WMS_RECEIPT_CHANNELS_ENABLED','true');expect(await canManageReceiptDirections(db,{...user,roleCodes:['ADMIN'],permissionCodes:['warehouse:write']},'lukin')).toBe(true);expect(await canManageReceiptDirections(db,{...user,roleCodes:['ADMIN']},'lukin')).toBe(false);});
