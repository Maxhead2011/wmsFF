import { afterEach, expect, it, vi } from 'vitest';
import { BillingService } from '../src/modules/billing/billing.service';
afterEach(()=>vi.unstubAllEnvs());
async function fixture(){
 vi.stubEnv('WMS_BILLING_SERVICE_READ_FAST_ENABLED','false');
 const db:any={billingService:{upsert:vi.fn(async(a:any)=>a.create),findMany:vi.fn()},clientBillingService:{upsert:vi.fn(),findMany:vi.fn()}};
 const s:any=new BillingService(db,{} as any);await s.ensureStandardBillingServices();
 const defaults=db.billingService.upsert.mock.calls.map((c:any,i:number)=>({...c[0].create,id:'s'+i}));
 db.billingService.upsert.mockClear();db.billingService.findMany.mockResolvedValue(defaults);db.clientBillingService.findMany.mockResolvedValue(defaults.map((s:any)=>({serviceId:s.id})));
 return {db,s,defaults};
}
// TEST: unchanged services must not wait for write locks just to show a price list.
it('reads initialized standard services without writes',async()=>{const {db,s}=await fixture();vi.stubEnv('WMS_BILLING_SERVICE_READ_FAST_ENABLED','true');await s.ensureStandardBillingServices();expect(db.billingService.upsert).not.toHaveBeenCalled();});
it('updates changed standard rows and creates missing ones only',async()=>{const {db,s,defaults}=await fixture();vi.stubEnv('WMS_BILLING_SERVICE_READ_FAST_ENABLED','true');db.billingService.findMany.mockResolvedValue(defaults.slice(1).map((s:any,i:number)=>i===0?{...s,isActive:false}:s));await s.ensureStandardBillingServices();expect(db.billingService.upsert.mock.calls.map((c:any)=>c[0].where.code)).toEqual([defaults[0].code,defaults[1].code]);});
it('preserves existing client prices without no-op upserts',async()=>{const {db,s}=await fixture();vi.stubEnv('WMS_BILLING_SERVICE_READ_FAST_ENABLED','true');await s.ensureStandardClientBillingServices('client','user');expect(db.clientBillingService.upsert).not.toHaveBeenCalled();expect(db.clientBillingService.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({clientId:'client'})}));});
it('creates only a missing client binding with race-safe empty update',async()=>{const {db,s,defaults}=await fixture();vi.stubEnv('WMS_BILLING_SERVICE_READ_FAST_ENABLED','true');db.clientBillingService.findMany.mockResolvedValue(defaults.slice(1).map((s:any)=>({serviceId:s.id})));await s.ensureStandardClientBillingServices('client','user');expect(db.clientBillingService.upsert).toHaveBeenCalledTimes(1);expect(db.clientBillingService.upsert).toHaveBeenCalledWith(expect.objectContaining({update:{},create:expect.objectContaining({clientId:'client',serviceId:defaults[0].id})}));});
it('keeps flag-off behavior unchanged',async()=>{const {db,s,defaults}=await fixture();await s.ensureStandardClientBillingServices('client','user');expect(db.billingService.upsert).toHaveBeenCalledTimes(defaults.length);expect(db.clientBillingService.upsert).toHaveBeenCalledTimes(defaults.length);expect(db.clientBillingService.findMany).not.toHaveBeenCalled();});
