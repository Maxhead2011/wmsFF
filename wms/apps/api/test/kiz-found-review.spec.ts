import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {KizFoundReview} from '../src/modules/inventory/kiz-found-review';
import {ClientScopeService} from '../src/modules/auth/client-scope.service';
const value='0104640569959539215eCUd%lbPYtuV';
const user:any={id:'admin',name:'Admin',roleCodes:['ADMIN'],permissionCodes:[],clientScopeMode:'LIMITED',clientIds:['c'],writableClientIds:['c'],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:['w']};
function setup(){
 let mark:any={id:'m',clientId:'c',skuId:'s',status:'SHIPPING',boxId:null,value,updatedAt:new Date('2026-10-01'),sku:{name:'Suit'},stockMovement:{warehouseId:'w'}};
 let rows:any[]=[];let links:any[]=[];
 const tx:any={productMark:{findFirst:vi.fn(async()=>({...mark})),findMany:vi.fn(async()=>[mark]),update:vi.fn(async({data}:any)=>{mark={...mark,...data,updatedAt:new Date()};return {...mark};})},
 kizReviewCase:{findFirst:vi.fn(async({where}:any)=>rows.find(r=>r.id===where.id)),findUnique:vi.fn(async({where}:any)=>rows.find(r=>where.id?r.id===where.id:r.taskId===where.taskId_kizIdentity.taskId)),create:vi.fn(async({data}:any)=>{const r={...data,id:'r'+rows.length};rows.push(r);return {...r};}),update:vi.fn(async({where,data}:any)=>{const r=rows.find(r=>r.id===where.id);Object.assign(r,data);return {...r};}),upsert:vi.fn(async({create}:any)=>create),findMany:vi.fn(async()=>rows)},
 auditLog:{create:vi.fn(async()=>({}))},$queryRaw:vi.fn(async()=>[]),box:{findFirst:vi.fn(async()=>({id:'b',code:'BOX',clientId:'c',warehouseId:'w',status:'active'})),findUnique:vi.fn(async()=>({id:'b',clientId:'c',warehouseId:'w',status:'active'}))},
 fbsTsdAssembly:{findMany:vi.fn(async()=>links),updateMany:vi.fn(async()=>({count:1}))},clientRequest:{findUnique:vi.fn(async()=>({status:'DONE',warehouseId:'w'}))},fboAssemblyUnit:{findFirst:vi.fn(async()=>null)},
 shippedKizHistory:{findMany:vi.fn(async()=>[{kiz:value,requestId:'old'}])},stockMovement:{create:vi.fn(async()=>({id:'movement'})),aggregate:vi.fn(async()=>({_sum:{quantity:0}}))},stockBalance:{upsert:vi.fn(async()=>({}))}};
 tx.$transaction=async(fn:any)=>fn(tx);
 const evidence={decision:'REVIEW',history:[],orders:[],checkedAt:new Date().toISOString()};const inspect=vi.fn(async()=>evidence);
 const service=new KizFoundReview(tx,new ClientScopeService(),inspect);
 const act=(action:string,extra:any={})=>service.act({action,markId:'m',id:'r0',reason:'Physical found',confirmed:true,...extra},user);
 return {service,tx,act,inspect,evidence,setLinks:(x:any[])=>links=x};
}
beforeEach(()=>vi.stubEnv('WMS_KIZ_FOUND_REVIEW_ENABLED','true'));afterEach(()=>vi.unstubAllEnvs());
describe('found KIZ without box',()=>{
 it('opens once and authorizes reuse without creating or moving stock',async()=>{
  // TEST: the reported SHIPPING/no-box case becomes reviewable without inventing a receipt.
  const s=setup();const a=await s.act('OPEN'),b=await s.act('OPEN');expect(a.id).toBe(b.id);expect(s.tx.kizReviewCase.create).toHaveBeenCalledOnce();
  const approved=await s.act('REUSE');expect(approved.resolution).toBe('REUSE');expect(approved.snapshot.returned).toBe(false);
  expect(s.tx.stockMovement.create).not.toHaveBeenCalled();expect(s.tx.productMark.update).not.toHaveBeenCalled();expect(s.tx.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();expect(s.tx.kizReviewCase.upsert).not.toHaveBeenCalled();
 });
 it('returns exactly once and activates permission only for the returned unit',async()=>{
  const s=setup();await s.act('OPEN');await s.act('REUSE');await s.act('RETURN',{boxCode:'BOX'});await s.act('RETURN',{boxCode:'BOX'});
  expect(s.tx.stockMovement.create).toHaveBeenCalledOnce();expect(s.tx.stockBalance.upsert).toHaveBeenCalledOnce();
  expect(s.tx.kizReviewCase.upsert.mock.calls[0][0].create).toMatchObject({taskId:'UNIT:m',status:'APPROVED',resolution:'REUSE',snapshot:{boxId:'b'}});
 });
 it('allows return first and later reuse authorization',async()=>{
  const s=setup();await s.act('OPEN');await s.act('RETURN',{boxCode:'BOX'});expect(s.tx.kizReviewCase.upsert).not.toHaveBeenCalled();await s.act('REUSE');expect(s.tx.kizReviewCase.upsert).toHaveBeenCalledOnce();
 });
 it('requires a valid destination for return',async()=>{const s=setup();await s.act('OPEN');s.tx.box.findFirst.mockResolvedValue(null);await expect(s.act('RETURN')).rejects.toThrow();expect(s.tx.stockMovement.create).not.toHaveBeenCalled();});
 it('cannot duplicate a still-reserved or unshipped unit',async()=>{const s=setup();await s.act('OPEN');s.tx.stockMovement.aggregate.mockResolvedValue({_sum:{quantity:1}});await expect(s.act('RETURN',{boxCode:'BOX'})).rejects.toThrow();expect(s.tx.stockMovement.create).not.toHaveBeenCalled();s.tx.shippedKizHistory.findMany.mockResolvedValue([]);await expect(s.act('RETURN',{boxCode:'BOX'})).rejects.toThrow();});
 it('can replace unused reuse permission with relabel decision',async()=>{const s=setup();await s.act('OPEN');await s.act('REUSE');s.evidence.decision='RELABEL';expect((await s.act('RELABEL')).resolution).toBe('RELABEL');expect(s.tx.stockMovement.create).not.toHaveBeenCalled();});
 it('blocks retired reuse but permits relabel authorization without stock',async()=>{const s=setup();await s.act('OPEN');s.evidence.decision='RELABEL';await expect(s.act('REUSE')).rejects.toThrow();expect((await s.act('RELABEL')).resolution).toBe('RELABEL');expect(s.tx.stockMovement.create).not.toHaveBeenCalled();});
 it('rejects pending case without changing stock',async()=>{const s=setup();await s.act('OPEN');expect((await s.act('REJECT')).status).toBe('REJECTED');expect(s.tx.stockMovement.create).not.toHaveBeenCalled();});
 it('does not treat rejection as reversal of an existing permission',async()=>{const s=setup();await s.act('OPEN');await s.act('REUSE');await expect(s.act('REJECT')).rejects.toThrow();});
 it.each(['WORKER','CLIENT','MANAGER'])('rejects %s before all DB access',async role=>{const s=setup();await expect(s.service.act({action:'OPEN',confirmed:true,reason:'found'}, {...user,roleCodes:[role]})).rejects.toThrow();expect(s.tx.productMark.findFirst).not.toHaveBeenCalled();});
 it('requires writable branch and client',async()=>{const s=setup();for(const denied of [{...user,writableWarehouseIds:[]},{...user,writableClientIds:[]}])await expect(s.service.act({action:'OPEN',markId:'m',reason:'found',confirmed:true},denied)).rejects.toThrow();expect(s.tx.kizReviewCase.create).not.toHaveBeenCalled();});
 it('keeps sold installations disabled',async()=>{const s=setup();vi.stubEnv('WMS_KIZ_FOUND_REVIEW_ENABLED','false');await expect(s.act('OPEN')).rejects.toThrow();expect(s.tx.productMark.findFirst).not.toHaveBeenCalled();});
 it('does not detach an active assembly or add stock even with release confirmation',async()=>{const s=setup();await s.act('OPEN');s.setLinks([{id:'task',clientId:'c',requestId:'req',kiz:value,status:'IN_PROGRESS',orderId:'123'}]);await expect(s.act('RETURN',{boxCode:'BOX',releaseBindings:true})).rejects.toThrow();expect(s.tx.stockMovement.create).not.toHaveBeenCalled();expect(s.tx.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();});
 it('archives historical binding only after explicit release confirmation',async()=>{const s=setup();await s.act('OPEN');await s.act('REUSE');s.setLinks([{id:'task',clientId:'c',requestId:'req',kiz:value,status:'COMPLETED',orderId:'123'}]);await s.act('RETURN',{boxCode:'BOX',releaseBindings:true});expect(s.tx.fbsTsdAssembly.updateMany).toHaveBeenCalledOnce();expect(s.tx.auditLog.create.mock.calls.some(c=>c[0].data.action==='KIZ_FOUND_BINDING_ARCHIVED')).toBe(true);});
 it('rejects duplicate identities before creating case',async()=>{const s=setup();s.tx.productMark.findMany.mockResolvedValue([{value},{value}]);await expect(s.act('OPEN')).rejects.toThrow();expect(s.tx.kizReviewCase.create).not.toHaveBeenCalled();});
});
