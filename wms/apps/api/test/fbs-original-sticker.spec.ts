import { afterEach, expect, it, vi } from 'vitest';
import { assertOriginalStickerIdentity, pinnedOriginalSticker } from '../src/modules/marketplace-connections/fbs-original-sticker';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
const label={partA:'5908010',partB:'9672',barcode:'*DcFy7mhD',imageBase64:'iVBORw0KGgoAAA=='};
const task={id:'new',clientId:'c',connectionId:'wb',orderId:'100',marketplace:'WILDBERRIES',stickerPartA:label.partA,stickerPartB:label.partB,stickerBarcode:label.barcode,marketplaceLabelBase64:label.imageBase64,marketplaceLabelContentType:'image/png; purpose=original-repeat'};
afterEach(()=>vi.unstubAllEnvs());
// TEST: a different WB label or missing original facts cannot silently replace the required sticker.
it('rejects changed identity and invalid image',()=>{
 for(const other of [{...label,partA:'1'},{...label,partB:'2'},{...label,barcode:'new'},{...label,imageBase64:'bad'}])expect(()=>assertOriginalStickerIdentity(task,other)).toThrow();
 expect(()=>assertOriginalStickerIdentity({...task,stickerPartA:null},label)).toThrow();
});
it('is isolated from ordinary WB/Ozon tasks and disabled installations',()=>{
 expect(pinnedOriginalSticker({...task,marketplaceLabelContentType:'image/png'})).toBeNull();
 expect(pinnedOriginalSticker({...task,marketplace:'OZON'})).toBeNull();
 vi.stubEnv('WMS_FBS_ORIGINAL_STICKER_ENABLED','false');expect(()=>pinnedOriginalSticker(task)).toThrow();
});
it('prints the pinned original without consulting mutable cache or remote WB',async()=>{
 vi.stubEnv('WMS_FBS_ORIGINAL_STICKER_ENABLED','true');
 const context={fbsTsdStickerCache:{get:vi.fn()},prisma:{clientMarketplaceConnection:{findFirst:vi.fn()},fbsAssemblyAttemptHistory:{findUnique:vi.fn().mockResolvedValue({taskSnapshot:{...task,id:'old',requestId:'r',skuId:'sku',status:'COMPLETED',completedAt:new Date().toISOString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}})}},persistFbsTsdOrderSticker:vi.fn()};
 const result=await (MarketplaceConnectionsService.prototype as any).loadFbsTsdOrderSticker.call(context,task);
 expect(result).toMatchObject({...label,contentType:'image/png'});expect(context.fbsTsdStickerCache.get).not.toHaveBeenCalled();expect(context.prisma.clientMarketplaceConnection.findFirst).not.toHaveBeenCalled();expect(context.persistFbsTsdOrderSticker).toHaveBeenCalledWith('new',expect.objectContaining({barcode:label.barcode}));
 const reset=await (MarketplaceConnectionsService.prototype as any).loadFbsTsdOrderSticker.call(context,{...task,stickerPartA:null,stickerPartB:null,stickerBarcode:null});expect(reset.barcode).toBe(label.barcode);
});

// TEST: preparing the original label does not count as picking a replacement unit.
it('allows untouched original-label tasks to release but protects physical scans',()=>{
 const check=(MarketplaceConnectionsService.prototype as any).isFbsTsdTaskUntouchedForAutoRelease;
 const untouched={...task,stickerPartA:null,stickerPartB:null,stickerBarcode:null,wbMetaStatus:'PENDING'};
 expect(check.call({},untouched)).toBe(true);
 expect(check.call({},{...untouched,kiz:'new-kiz'})).toBe(false);
 expect(check.call({},{...untouched,barcode:'physical-sku'})).toBe(false);
 expect(check.call({},{...untouched,marketplaceLabelContentType:'image/png'})).toBe(false);
});
