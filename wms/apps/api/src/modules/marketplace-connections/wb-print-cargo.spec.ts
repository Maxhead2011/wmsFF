import {afterEach,expect,it,vi} from 'vitest';
import {wbPrintCargo} from './wb-print-cargo';
vi.mock('./fbs-stickers-pdf',()=>({buildFbsCargoPlaceStickersPdf:vi.fn(async()=>Buffer.from('pdf'))}));
afterEach(()=>vi.unstubAllEnvs());
function fixture(initial:string[]=[],count=0){
 vi.stubEnv('WMS_WB_SHIPPING_POINTS_ENABLED','true');let ids=initial,pending:any=null,confirmed:any=null;
 const host:any={clientScopes:{requireClientAccess:vi.fn()},loadSelectedConnections:vi.fn(async()=>[{id:'c',apiKey:'test'}]),prisma:{
  $transaction:vi.fn(async(fn:any)=>fn({$executeRaw:vi.fn()})),
  fbsSupplyPlan:{findFirst:vi.fn(async()=>({id:'p',deliveryDestination:'PICKUP_POINT',cargoPlaceCount:count})),update:vi.fn()},
  auditLog:{findFirst:vi.fn(async({where}:any)=>where.action==='WB_CARGO_CREATE_PENDING'?pending:confirmed),create:vi.fn(async({data}:any)=>{if(data.action==='WB_CARGO_CREATE_PENDING')pending={...data,createdAt:new Date()};else confirmed=data;})}
 }};
 const json=vi.fn(async(url:string,init:any)=>{
  if(url.endsWith('/trbx')){if(init.method==='POST')ids=Array.from({length:JSON.parse(init.body).amount},(_,i)=>'box'+i);return {trbxes:ids.map(id=>({id}))};}
  if(url.endsWith('/order-ids'))return {orderIds:[1,2,3,4]};
  if(url.includes('/stickers'))return {stickers:ids.map(id=>({barcode:id,file:'png'}))};
  return {id:'WB-GI-1',done:false};
 });
 const run=()=>wbPrintCargo(host,'client',[{id:'1',connectionId:'c',supplyId:'WB-GI-1',marketplace:'WILDBERRIES'}],{id:'u'},json,true);
 return {host,json,run,setIds:(v:string[])=>ids=v,setPending:()=>pending={payload:{target:1},createdAt:new Date()}};
}
// TEST: real helper preserves manually created boxes and never repeats an uncertain POST.
it('creates one missing cargo place and reuses it on repeat',async()=>{
 const f=fixture();await f.run();await f.run();
 expect(f.json.mock.calls.filter(([u,i])=>u.endsWith('/trbx')&&i.method==='POST')).toHaveLength(1);
 expect(f.host.prisma.fbsSupplyPlan.update).toHaveBeenCalledWith({where:{id:'p'},data:{cargoPlaceIds:['box0'],cargoPlaceCount:1}});
 expect(f.host.clientScopes.requireClientAccess).toHaveBeenCalledWith({id:'u'},'client','write');
});
it('uses the saved count when cargo is absent',async()=>{const f=fixture([],2);await f.run();expect(f.json.mock.calls.find(([u,i])=>u.endsWith('/trbx')&&i.method==='POST')![1].body).toBe('{"amount":2}');});
it('reuses manually created cargo without creating or changing the plan',async()=>{const f=fixture(['manual']);await f.run();expect(f.host.prisma.fbsSupplyPlan.update).not.toHaveBeenCalled();expect(f.json.mock.calls.some(([u,i])=>u.endsWith('/trbx')&&i.method==='POST')).toBe(false);});
it('reconciles a lost create response without repeating the mutation',async()=>{
 const f=fixture(),original=f.json.getMockImplementation()!;
 f.json.mockImplementation(async(u,i)=>{if(u.endsWith('/trbx')&&i.method==='POST'){f.setIds(['accepted']);throw Error('timeout');}return original(u,i);});
 await f.run();await f.run();expect(f.json.mock.calls.filter(([u,i])=>u.endsWith('/trbx')&&i.method==='POST')).toHaveLength(1);
});
it('blocks an unresolved previous creation',async()=>{const f=fixture();f.setPending();await expect(f.run()).rejects.toThrow('предыдущего');expect(f.json.mock.calls.some(([u,i])=>u.endsWith('/trbx')&&i.method==='POST')).toBe(false);});
it('does not create for a closed supply',async()=>{const f=fixture(),original=f.json.getMockImplementation()!;f.json.mockImplementation((u,i)=>u.endsWith('/WB-GI-1')?Promise.resolve({id:'WB-GI-1',done:true}):original(u,i));await expect(f.run()).rejects.toThrow('закрыта');expect(f.host.prisma.auditLog.create).not.toHaveBeenCalled();});
it('does not invent pickup destination or exceed the WB count limit',async()=>{const f=fixture([],3);await expect(f.run()).rejects.toThrow('не разрешает');f.host.prisma.fbsSupplyPlan.findFirst.mockResolvedValue({id:'p',deliveryDestination:'VNUKOVO_SORTING_CENTER'});await expect(f.run()).rejects.toThrow('направление');expect(f.host.prisma.auditLog.create).not.toHaveBeenCalled();});
it('rechecks remote cargo under the shared lock',async()=>{const f=fixture();f.host.prisma.$transaction.mockImplementation(async(fn:any)=>{f.setIds(['concurrent']);return fn({$executeRaw:vi.fn()});});await f.run();expect(f.json.mock.calls.some(([u,i])=>u.endsWith('/trbx')&&i.method==='POST')).toBe(false);});
