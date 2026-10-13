import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { FboTwoStageService } from '../src/modules/tsd/fbo-two-stage.service';
import { fboBarcodeAliases, fboBarcodeMatches } from '../src/modules/tsd/fbo-barcode-aliases';
const line = { skuId: 'greta54', barcode: '4630584392961', sku: { barcodes: [{ value: '4610389218703' }, { value: '4630584392961' }] } };
afterEach(() => vi.unstubAllEnvs());
// TEST: execute the real packing handler up to the stock boundary; no real database writes.
it.each(['4610389218703', '4630584392961', 'wrong'])('packing resolves %s without bypassing physical unit checks', async barcode => {
 vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','false');
 const item={...line,id:'i',quantity:1};
 const compositionHash=createHash('sha256').update(JSON.stringify([['i','greta54','4630584392961',1]])).digest('hex');
 const tx:any={$queryRaw:vi.fn(),fboAssemblyAction:{findUnique:async()=>null},fboAssembly:{findUnique:async()=>({phase:'PACKING',compositionHash})},fboAssemblyUnit:{findMany:async()=>[{id:'u',requestItemId:'i',skuId:'greta54',barcode:line.barcode,state:'PICKED',wholeBox:false,markId:null}]},fboAssemblyBox:{findUnique:async()=>({requestId:'r',closedAt:null,wholeBox:false})},box:{findUniqueOrThrow:async()=>({id:'holding'})}};
 const svc:any=new FboTwoStageService({$transaction:async(fn:any)=>fn(tx)} as never,null as never,null as never,null as never,{assertStockMovementsAllowed:async()=>{}} as never,null as never);
 svc.load=async()=>({id:'r',status:'IN_WORK',items:[item],client:{}});svc.requireFbo=()=>{};svc.box=async()=>({id:'target'});
 svc.move=vi.fn(async()=>{throw Error('STOCK_BOUNDARY');});
 const result=svc.act('r',{action:'PACK_UNIT',operationId:'op',barcode,targetBoxCode:'target'},{id:'worker'});
 if(barcode==='wrong'){await expect(result).rejects.not.toThrow('STOCK_BOUNDARY');expect(svc.move).not.toHaveBeenCalled();}
 else {await expect(result).rejects.toThrow('STOCK_BOUNDARY');expect(svc.move.mock.calls[0].slice(2,7)).toEqual(['greta54','holding','target','PACKING','PACKING']);}
});
// TEST: receipt and request barcodes identify the same physical SKU, never its description.
it('accepts the receipt barcode of Greta for the request SKU', () => {
 expect(fboBarcodeAliases(line, [line])).toEqual(['4630584392961', '4610389218703']);
 expect(fboBarcodeMatches('greta54', '4610389218703', [line])).toBe(true);
 expect(fboBarcodeMatches('greta56', '4610389218703', [line])).toBe(false);
 expect(fboBarcodeMatches('greta54', 'unknown', [line])).toBe(false);
});
it('rejects ambiguous barcode ownership even when one line is already picked', () => {
 const other = { ...line, skuId: 'greta56' };
 expect(fboBarcodeMatches('greta54', '4610389218703', [line, other])).toBe(false);
 expect(fboBarcodeAliases(line, [line, other])).toEqual([]);
});
