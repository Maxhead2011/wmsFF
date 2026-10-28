import {afterEach,describe,it,expect,vi} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';
// TEST: a single Ozon label must not refresh all client marketplaces/history.
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
function service(){
 const s:any=Object.create(MarketplaceConnectionsService.prototype);
 s.clientScopes={requireClientAccess:vi.fn()};
 s.prisma={clientMarketplaceConnection:{findMany:vi.fn(async()=>[{id:'c',clientId:'client',marketplace:'OZON',isActive:true,sellerId:'seller',apiKey:'test'}])}};
 s.resolveSelectedFbsOrders=vi.fn(async()=>{throw new Error('Full marketplace/history reload');});return s;
}
const dto={clientId:'client',orders:[{connectionId:'c',id:'01998160-1562-1'}]};
describe('selected Ozon label download',()=>{
 it('downloads only the selected posting without a full order load',async()=>{
  vi.stubEnv('WMS_OZON_DIRECT_LABEL_ENABLED','true');const s=service();const doc=await PDFDocument.create();doc.addPage([100,100]);const pdf=await doc.save();
  const fetch=vi.fn(async(url:any)=>String(url).endsWith('/get')?new Response(JSON.stringify({result:{posting_number:dto.orders[0].id,status:'awaiting_deliver'}}),{headers:{'Content-Type':'application/json'}}):new Response(pdf,{headers:{'Content-Type':'application/pdf'}}));vi.stubGlobal('fetch',fetch);
  const result=await s.getFbsOrderStickersPdf(dto,{});expect(result.count).toBe(1);expect(result.buffer.subarray(0,4).toString()).toBe('%PDF');expect(s.resolveSelectedFbsOrders).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(2);
 });
});
import {selectedOzonLabels} from '../src/modules/marketplace-connections/ozon-direct-label';
// TEST: access/status/identity gates remain in force on the fast path.
describe('Ozon direct label guards',()=>{
 it('does not call external APIs for an inaccessible cabinet',async()=>{
  vi.stubEnv('WMS_OZON_DIRECT_LABEL_ENABLED','true');const json=vi.fn(),binary=vi.fn();
  await expect(selectedOzonLabels({clientMarketplaceConnection:{findMany:async()=>[]}},'client',dto.orders,json,binary)).rejects.toThrow();expect(json).not.toHaveBeenCalled();expect(binary).not.toHaveBeenCalled();
 });
 it.each(['cancelled','awaiting_packaging'])('rejects status %s',async status=>{
  vi.stubEnv('WMS_OZON_DIRECT_LABEL_ENABLED','true');const s=service(),binary=vi.fn();
  await expect(selectedOzonLabels(s.prisma,'client',dto.orders,async()=>({result:{posting_number:dto.orders[0].id,status}}),binary)).rejects.toThrow();expect(binary).not.toHaveBeenCalled();
 });
 it('rejects a mismatching posting number',async()=>{
  vi.stubEnv('WMS_OZON_DIRECT_LABEL_ENABLED','true');const binary=vi.fn();
  await expect(selectedOzonLabels(service().prisma,'client',dto.orders,async()=>({result:{posting_number:'other',status:'awaiting_deliver'}}),binary)).rejects.toThrow();expect(binary).not.toHaveBeenCalled();
 });
 it('leaves disabled installations and mixed selections on the old path',async()=>{
  vi.stubEnv('WMS_OZON_DIRECT_LABEL_ENABLED','false');const s=service();expect(await selectedOzonLabels(s.prisma,'client',dto.orders,vi.fn(),vi.fn())).toBeNull();expect(s.prisma.clientMarketplaceConnection.findMany).not.toHaveBeenCalled();
  vi.stubEnv('WMS_OZON_DIRECT_LABEL_ENABLED','true');s.prisma.clientMarketplaceConnection.findMany.mockResolvedValue([{id:'c',marketplace:'WILDBERRIES'}]);expect(await selectedOzonLabels(s.prisma,'client',dto.orders,vi.fn(),vi.fn())).toBeNull();
 });
 it('deduplicates selection and applies timeouts to both requests',async()=>{
  vi.stubEnv('WMS_OZON_DIRECT_LABEL_ENABLED','true');const json=vi.fn(async()=>({result:{posting_number:dto.orders[0].id,status:'awaiting_deliver'}})),binary=vi.fn(async()=>({buffer:Buffer.from('pdf'),contentType:'application/pdf'}));
  expect((await selectedOzonLabels(service().prisma,'client',[...dto.orders,...dto.orders],json,binary))?.count).toBe(1);expect(json).toHaveBeenCalledTimes(1);expect(binary).toHaveBeenCalledTimes(1);expect((json.mock.calls as any)[0][1].signal).toBeInstanceOf(AbortSignal);expect((binary.mock.calls as any)[0][1].signal).toBeInstanceOf(AbortSignal);
 });
 it('checks client access before any lookup',async()=>{
  vi.stubEnv('WMS_OZON_DIRECT_LABEL_ENABLED','true');const s=service();s.clientScopes.requireClientAccess.mockImplementation(()=>{throw new Error('denied');});await expect(s.getFbsOrderStickersPdf(dto,{})).rejects.toThrow('denied');expect(s.prisma.clientMarketplaceConnection.findMany).not.toHaveBeenCalled();
 });
});
