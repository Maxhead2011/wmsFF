import { createHash } from 'node:crypto';
import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { normalizeReceiptProfile,applyReceiptPrimary,receiptProfileAmount,receiptProcessingByBoxes,saveReceiptProcessing } from '../src/modules/billing/receipt-processing';
import { ReceiptProcessingController } from '../src/modules/billing/receipt-processing.controller';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { receiptFboPlan,saveReceiptFboCharges } from '../src/modules/billing/receipt-processing-fbo';
afterEach(()=>vi.unstubAllEnvs());
const profile={unitPriceRub:'10.00',taxMode:'INCLUDED' as const,includedServiceIds:['included']};
const selection={receiptId:'r',kind:'GRAY' as const,revision:1,profile,pricingRevision:1};
const line=(key:string,serviceId:string|null=null)=>({key,description:key,quantity:3,unitPriceRub:2,priceBeforeTaxRub:2,taxMode:'INCLUDED' as const,serviceId,serviceCode:key});
// TEST: an explicit receipt price replaces the base and suppresses included services only.
it('avoids double billing of included work and preserves extra work',()=>{
 const lines=applyReceiptPrimary([line('WHITE'),line('GRAY'),line('SERVICE:included','included'),line('SERVICE:extra','extra')],selection,3);
 expect(lines.map(l=>l.key)).toEqual(['RECEIPT_GRAY','SERVICE:extra']);expect(lines[0]).toMatchObject({quantity:3,unitPriceRub:10});
});
it('preserves unselected receipts and returns',()=>{const lines=[line('RETURN')];expect(applyReceiptPrimary(lines,selection,3)).toBe(lines);expect(applyReceiptPrimary(lines,undefined,3)).toBe(lines);});
it('keeps exact tax precision until line rounding',()=>{expect(receiptProfileAmount({...profile,unitPriceRub:'10.64',taxMode:'ADD_6_PERCENT'}).mul(12).toFixed(2)).toBe('135.83');});
it.each(['-1','NaN','Infinity','1e4','1.234'])('rejects invalid amount %s',price=>expect(()=>normalizeReceiptProfile({...profile,unitPriceRub:price},['included'])).toThrow());
it('rejects duplicate and unknown services',()=>{expect(()=>normalizeReceiptProfile({...profile,includedServiceIds:['included','included']},['included'])).toThrow();expect(()=>normalizeReceiptProfile(profile,[])).toThrow();expect(normalizeReceiptProfile({...profile,unitPriceRub:'10,64'},['included']).unitPriceRub).toBe('10.64');});
it('does not touch sold billing',async()=>{vi.stubEnv('WMS_RECEIPT_PROCESSING_ENABLED','false');expect(await receiptProcessingByBoxes({} as any,'c',['b'])).toEqual(new Map());expect(await receiptFboPlan({} as any,{request:{id:'r',clientId:'c'},processedUnits:1})).toBe(null);await expect(saveReceiptProcessing({} as any,{} as any,{} as any)).rejects.toThrow();});
it('rejects combined or missing receipt kinds before reads/writes',async()=>{vi.stubEnv('WMS_RECEIPT_PROCESSING_ENABLED','true');for(const kind of ['BOTH',null,['WHITE','GRAY']])await expect(saveReceiptProcessing({} as any,{kind,revision:0} as any,{} as any)).rejects.toThrow();});
it('does not expose or mutate foreign client profiles',async()=>{vi.stubEnv('WMS_RECEIPT_PROCESSING_ENABLED','true');const c=new ReceiptProcessingController({} as any,new ClientScopeService());const user:any={clientScopeMode:'LIMITED',clientIds:['own'],writableClientIds:['own'],roleCodes:['ADMIN'],permissionCodes:['billing:write']};await expect(c.get(user,'foreign')).rejects.toThrow();await expect(c.save(user,'foreign',{revision:0})).rejects.toThrow();});
it('rejects read-only and demo writes',async()=>{vi.stubEnv('WMS_RECEIPT_PROCESSING_ENABLED','true');const c=new ReceiptProcessingController({} as any,new ClientScopeService());for(const user of [{roleCodes:['CLIENT'],isDemo:false},{roleCodes:['ADMIN'],isDemo:true}])await expect(c.save({...user,clientScopeMode:'ALL',clientIds:[],writableClientIds:[]} as any,'c',{revision:0})).rejects.toThrow();});
it('preserves existing FBO billing snapshots before loading new profiles',async()=>{vi.stubEnv('WMS_RECEIPT_PROCESSING_ENABLED','true');const db:any={$queryRaw:vi.fn(),billingCharge:{findMany:vi.fn().mockResolvedValue([]),findFirst:vi.fn().mockResolvedValue({sourceKey:'old'})}};expect(await receiptFboPlan(db,{request:{id:'r',clientId:'c'},processedUnits:3})).toBe(null);});
it('writes FBO groups independently and preserves snapshots on replay',async()=>{const db:any={billingCharge:{create:vi.fn()}};const input={request:{id:'r',clientId:'c'},user:{id:'u'},serviceDate:new Date()};const units=[{skuId:'sku',sourceBoxCode:'gray',selection},{skuId:'sku',sourceBoxCode:'white',selection:{...selection,receiptId:'r2',kind:'WHITE' as const,profile:{...profile,unitPriceRub:'20'}}}];await saveReceiptFboCharges(db,input,{units,existing:false});expect(db.billingCharge.create.mock.calls.map((c:any)=>c[0].data.totalRub.toString())).toEqual(['10','20']);db.billingCharge.create.mockClear();await saveReceiptFboCharges(db,input,{units,existing:true});expect(db.billingCharge.create).not.toHaveBeenCalled();});

// TEST: production Prisma has no Box.receiptStockIdentity relation; read the materialized SQL index.
it('resolves selected boxes with a batched SQL join and preserves return pricing',async()=>{
 vi.stubEnv('WMS_RECEIPT_PROCESSING_ENABLED','true');
 const code='FFL_X_001', receiptAt=new Date('2026-10-20');
 const id=createHash('sha256').update(JSON.stringify(['c','w','SERIES:2026:FFL_X'])).digest('hex').slice(0,32);
 const db:any={$queryRaw:vi.fn().mockResolvedValue([{id:'b',code,warehouseId:'w',receiptAt},{id:'return',code:'FFL_RETURN_001',warehouseId:'w',receiptAt}]),systemSetting:{findMany:vi.fn().mockResolvedValueOnce([{key:'receipt.processing.v1:c:w:'+id,value:{kind:'GRAY',revision:1}}]).mockResolvedValueOnce([]),findUnique:vi.fn().mockResolvedValue({value:{GRAY:profile,revision:2}})}};
 const found=await receiptProcessingByBoxes(db,'c',[code,'FFL_RETURN_001']);
 expect(found.size).toBe(1);expect(found.get(code)).toMatchObject({kind:'GRAY',pricingRevision:2});
 expect(db.$queryRaw).toHaveBeenCalledTimes(1);
});
