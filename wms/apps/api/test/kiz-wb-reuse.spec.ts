import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideKizReuse, inspectKizReuse, pendingSizeKizRelabel } from '../src/common/kiz-wb-reuse';
import { KizCirculationCryptoService } from '../src/modules/kiz-circulation/kiz-circulation-crypto.service';

describe('KIZ reuse evidence', () => {
  // TEST: planned size relabel bypass remains compatible with the published relabel module.
  it('distinguishes pending size relabel from completed and ordinary relabel', () => {
    vi.stubEnv('WMS_FBS_KIZ_RELABEL_ENABLED', 'true');
    const task = {requiresKiz:true,relabelRequired:true,sourceSkuId:'source',relabelConfirmedAt:null};
    expect(pendingSizeKizRelabel(task)).toBe(true);
    expect(pendingSizeKizRelabel({...task,relabelConfirmedAt:new Date()})).toBe(false);
    expect(pendingSizeKizRelabel({...task,sourceSkuId:null})).toBe(false);
    vi.stubEnv('WMS_FBS_KIZ_RELABEL_ENABLED', 'false');
    expect(pendingSizeKizRelabel(task)).toBe(false);
    vi.unstubAllEnvs();
  });
  const cancelled = { verified: true, supplierStatus: 'cancel', wbStatus: 'canceled_by_client',
    containsKiz: false, supplyAccepted: false };
  // TEST: binding, local closure and cancellation alone do not prove a sale.
  it('allows a non-retired code only after all previous orders are confirmed unshipped and released', () => {
    expect(decideKizReuse([cancelled], 'INTRODUCED')).toBe('ALLOW');
    expect(decideKizReuse([cancelled], null)).toBe('REVIEW');
    expect(decideKizReuse([{ ...cancelled, supplierStatus: 'complete' }], 'INTRODUCED')).toBe('REVIEW');
  });
  // TEST: a different KIZ in the repeat order cannot transfer its sale to the original unit.
  it('requires matching KIZ for marketplace sale/return evidence', () => {
    expect(decideKizReuse([{ ...cancelled, wbStatus: 'sold', containsKiz: false }], 'INTRODUCED')).toBe('REVIEW');
    expect(decideKizReuse([{ ...cancelled, wbStatus: 'sold', containsKiz: true }], null)).toBe('RELABEL');
    expect(decideKizReuse([{ ...cancelled, containsKiz: true, supplyAccepted: true }], null)).toBe('RELABEL');
  });
  // TEST: failures, active bindings and unresolved history never turn into a free code.
  it('keeps ambiguous and still-bound codes on review', () => {
    expect(decideKizReuse([{ ...cancelled, verified: false }], 'INTRODUCED')).toBe('REVIEW');
    expect(decideKizReuse([{ ...cancelled, containsKiz: true }], 'INTRODUCED')).toBe('REVIEW');
    expect(decideKizReuse([cancelled, { ...cancelled, supplierStatus: 'confirm' }], 'INTRODUCED')).toBe('REVIEW');
    expect(decideKizReuse([], 'INTRODUCED')).toBe('REVIEW');
    expect(decideKizReuse([cancelled], 'RETIRED')).toBe('RELABEL');
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
// TEST: returned AVAILABLE marking still has history, and remote order outcome belongs only to its exact serial.
it('reports the first request and refuses to infer use from a successor KIZ', async () => {
  const kiz='0104640684261708215lg"wSKJpPnsk';
  const db:any={
    fbsTsdAssembly:{findMany:vi.fn(async()=>[])},
    fbsAssemblyAttemptHistory:{findMany:vi.fn(async()=>[{kiz,orderId:'123',requestId:'old',completedAt:new Date('2026-09-04T14:36:38Z'),taskSnapshot:{connectionId:'c',supplyId:'s',workerName:'Карина'}}])},
    shippedKizHistory:{findMany:vi.fn(async()=>[{kiz,orderId:'123',requestId:'old',shippedAt:new Date('2026-09-04T15:57:48Z'),supplyId:'s'}])},
    fbsWebKizStickerPrint:{findMany:vi.fn(async()=>[])},
    clientRequest:{findMany:vi.fn(async()=>[{id:'old',number:646,warehouseId:'wh',status:'DONE'}])},
    fbsOrderRequestLink:{findFirst:vi.fn(async()=>({connectionId:'c',lastSupplyId:'s'}))},
    clientMarketplaceConnection:{findFirst:vi.fn(async()=>({apiKey:'test'}))},
    kizTrueApiConnection:{findUnique:vi.fn(async()=>null)},
  };
  let remoteKiz='0104640684261708215C=IsXFS:OBFH';
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith('orders/status')
    ?{orders:[{id:123,supplierStatus:'complete',wbStatus:'sold'}]}
    :url.endsWith('orders/meta')?{orders:[{id:123,meta:{sgtin:{value:[remoteKiz]}}}]}:{scanDt:'2026-09-05T00:00:00Z'}})));
  const result=await inspectKizReuse(db,'client',kiz,'current');
  expect(result.decision).toBe('REVIEW');
  expect(result.history[0]).toMatchObject({request:{number:646},worker:'Карина'});
  expect(db.fbsAssemblyAttemptHistory.findMany.mock.calls[0][0].where.clientId).toBe('client');
  remoteKiz=kiz+'\u001d91EE12\u001d92signature';
  expect((await inspectKizReuse(db,'client',kiz,'current')).decision).toBe('RELABEL');
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('timeout');}));
  expect((await inspectKizReuse(db,'client',kiz,'current')).decision).toBe('REVIEW');
  // TEST: full read-only pipeline permits reuse only with a fresh exact True API response and released bindings.
  db.kizTrueApiConnection.findUnique.mockResolvedValue({isActive:true,apiTokenEncrypted:'test',productGroup:'lp',apiBaseUrl:'https://markirovka.crpt.ru/api/v3/true-api'});
  vi.spyOn(KizCirculationCryptoService.prototype,'decrypt').mockReturnValue('test');
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('/cises/info')
    ?[{cisInfo:{requestedCis:kiz,status:'INTRODUCED'}}]
    :url.endsWith('orders/status')?{orders:[{id:123,supplierStatus:'cancel',wbStatus:'canceled_by_client'}]}
    :url.endsWith('orders/meta')?{orders:[{id:123,meta:{sgtin:{value:[]}}}]}:{scanDt:null}})));
  expect((await inspectKizReuse(db,'client',kiz,'current')).decision).toBe('ALLOW');
  db.fbsTsdAssembly.findMany.mockResolvedValue([{kiz,orderId:'123',requestId:'old',completedAt:new Date(),wbMetaStatus:'ACCEPTED'}]);
  expect((await inspectKizReuse(db,'client',kiz,'current')).decision).toBe('REVIEW');
});
