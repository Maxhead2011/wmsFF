import {afterEach, describe, expect, it, vi} from 'vitest';
import {prepareOzonPrint, isOzonPrintPrepared, decorateOzonPrintPrepared} from './ozon-print-preparation';

afterEach(()=>vi.unstubAllEnvs());
function fixture() {
 vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED','true');
 const records=new Map<string,any>();
 const posting:any={posting_number:'o',status:'awaiting_packaging',products:[{sku:42,quantity:2}],requirements:{},available_actions:['ship']};
 const db:any={
  clientMarketplaceConnection:{findMany:vi.fn().mockResolvedValue([{id:'c',marketplace:'OZON',sellerId:'seller',apiKey:'secret'}])},
  fbsOrderRequestLink:{findMany:vi.fn().mockResolvedValue([{connectionId:'c',orderId:'o',requestId:'r',syncStatus:'ACTIVE',request:{status:'SUBMITTED',warehouseId:'w'}}])},
  systemSetting:{findUnique:vi.fn(async({where}:any)=>records.has(where.key)?{value:records.get(where.key)}:null),findMany:vi.fn(async()=>[...records].map(([key,value])=>({key,value}))),upsert:vi.fn(async({where,create,update}:any)=>{records.set(where.key,records.has(where.key)?update.value:create.value);})},
  auditLog:{create:vi.fn()},stockMovement:{create:vi.fn()},fbsTsdAssembly:{update:vi.fn(),create:vi.fn()},
  $queryRaw:vi.fn().mockResolvedValue([{locked:true}]),
 };
 db.$transaction=async(fn:any)=>fn(db);
 const json=vi.fn(async(url:string)=>{
  if(url.endsWith('/create-or-get'))return {posting_number:'o',multi_box_qty:1,products:[{product_id:42,quantity:2,exemplars:[{exemplar_id:1,gtd:'already-filled'},{exemplar_id:2,gtd:'already-filled'}]}]};
  if(url.endsWith('/get'))return {result:structuredClone(posting)};
  if(url.endsWith('/ship')){posting.status='awaiting_deliver';return {result:[{posting_number:'o'}]};}
  throw Error('Unexpected URL');
 });
 return {db,json,posting,records,run:()=>prepareOzonPrint(db,'client',[{connectionId:'c',id:'o'}],{id:'u',activeWarehouseId:'w'},json)};
}
describe('Ozon labels before physical picking',()=>{
 // TEST: request3319 must name the posting, article and missing GTD instead of a bare Ozon code.
 it('explains incomplete exemplar data using the live posting requirements',async()=>{
  const f=fixture();f.posting.products[0].offer_id='red_50';f.posting.requirements.products_requiring_gtd=[42];
  const original=f.json.getMockImplementation()!;f.json.mockImplementation(async(url:string)=>{if(url.endsWith('/ship'))throw Error('Ozon вернул HTTP 400 (3): EXEMPLAR_INFO_NOT_FILLED_COMPLETELY.');return original(url);});
  await expect(f.run()).rejects.toThrow(/Отправление o[\s\S]*red_50[\s\S]*ГТД/);
  expect(f.db.stockMovement.create).not.toHaveBeenCalled();
 });
 // TEST: requirements alone do not mean data is missing; a successful submission stays allowed.
 it('accepts a required GTD already completed at Ozon and bounds network waits',async()=>{
  const f=fixture();f.posting.requirements.products_requiring_gtd=[42];await expect(f.run()).resolves.toMatchObject({prepared:1});
  for(const call of f.json.mock.calls)expect((call as any)[1].signal).toBeInstanceOf(AbortSignal);
 });
 it('rejects a concurrent preparation before contacting Ozon',async()=>{
  const f=fixture();f.db.$queryRaw.mockResolvedValue([{locked:false}]);
  await expect(f.run()).rejects.toThrow('уже выполняется');expect(f.json).not.toHaveBeenCalled();
 });
 // TEST: reproduces 3290/3299: an open linked order has no TSD task yet.
 it('prepares an official label without requiring or fabricating a physical pick',async()=>{
  const f=fixture();expect(await f.run()).toMatchObject({prepared:1});
  expect(f.json.mock.calls.filter(([url])=>url.endsWith('/ship'))).toHaveLength(1);
  expect(f.db.stockMovement.create).not.toHaveBeenCalled();
  expect(f.db.fbsTsdAssembly.create).not.toHaveBeenCalled();expect(f.db.fbsTsdAssembly.update).not.toHaveBeenCalled();
  expect(await isOzonPrintPrepared(f.db,'client','c','o',f.posting)).toBe(true);
 });
 it('does not submit the order again on a repeated print',async()=>{
  const f=fixture();await f.run();await f.run();
  expect(f.json.mock.calls.filter(([url])=>url.endsWith('/ship'))).toHaveLength(1);
 });
 it('preserves unknown remote outcomes for an idempotent retry',async()=>{
  const f=fixture();f.json.mockImplementationOnce(async()=>({result:structuredClone(f.posting)})).mockImplementationOnce(async()=>{f.posting.status='awaiting_deliver';throw Error('timeout');});
  await expect(f.run()).rejects.toThrow('timeout');
  expect(await isOzonPrintPrepared(f.db,'client','c','o',f.posting)).toBe(true);
  expect(await f.run()).toMatchObject({prepared:1});
 });
 it('keeps marked orders on the existing physical-pick and KIZ submission path',async()=>{
  const f=fixture();f.posting.requirements.products_requiring_mandatory_mark=[42];
  expect(await f.run()).toEqual({prepared:0,orderIds:[],requiresPhysicalSubmission:[{connectionId:'c',id:'o'}]});
  expect(f.json.mock.calls.filter(([url])=>url.endsWith('/ship'))).toHaveLength(0);expect(f.db.systemSetting.upsert).not.toHaveBeenCalled();
 });
 it.each(['cancelled','multibox','quantity','identity','closed','warehouse','removed','disabled'])('rejects %s before any submission',async mode=>{
  const f=fixture();
  if(mode==='cancelled')f.posting.status='cancelled';
  if(mode==='multibox')f.posting.is_multibox=true;
  if(mode==='quantity')f.posting.products[0].quantity=0;
  if(mode==='identity')f.posting.posting_number='other';
  if(mode==='closed')f.db.fbsOrderRequestLink.findMany.mockResolvedValue([{connectionId:'c',orderId:'o',syncStatus:'ACTIVE',request:{status:'DONE',warehouseId:'w'}}]);
  if(mode==='warehouse')f.db.fbsOrderRequestLink.findMany.mockResolvedValue([{connectionId:'c',orderId:'o',syncStatus:'ACTIVE',request:{status:'SUBMITTED',warehouseId:'other'}}]);
  if(mode==='removed')f.db.fbsOrderRequestLink.findMany.mockResolvedValue([]);
  if(mode==='disabled')vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED','false');
  await expect(f.run()).rejects.toThrow();expect(f.json.mock.calls.filter(([url])=>url.endsWith('/ship'))).toHaveLength(0);
 });
 it('does not treat a changed composition as pending local picking',async()=>{
  const f=fixture();await f.run();f.posting.products[0].quantity=3;
  expect(await isOzonPrintPrepared(f.db,'client','c','o',f.posting)).toBe(false);
 });
 it('keeps prepared orders pickable but never revives delivered orders',async()=>{
  const f=fixture();await f.run();
  const rows:any[]=[{marketplace:'OZON',id:'o',connectionId:'c',supplierStatus:'awaiting_deliver',request:{id:'r'}},{marketplace:'OZON',id:'o',connectionId:'c',supplierStatus:'delivered',request:{id:'r'}}];
  await decorateOzonPrintPrepared(f.db,'client',rows);
  expect(rows[0].ozonPrintPrepared).toBe(true);expect(rows[1].ozonPrintPrepared).not.toBe(true);
 });
});
