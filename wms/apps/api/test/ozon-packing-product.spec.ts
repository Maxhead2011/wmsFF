// TEST: actual service transactions, destination quotas and durable replay.
import { it, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FboTwoStageService as SourceService } from '../src/modules/tsd/fbo-two-stage.service';
import { ozonPackingSuggestions as sourceSuggestions } from '../src/modules/tsd/ozon-packing-suggestion';
// TEST: reuse identical behavior assertions against the deployed-runtime candidate.
const FboTwoStageService = process.env.OZON_PRODUCT_RUNTIME ? require(process.env.OZON_PRODUCT_RUNTIME + '/modules/tsd/fbo-two-stage.service.js').FboTwoStageService : SourceService;
const ozonPackingSuggestions = process.env.OZON_PRODUCT_RUNTIME ? require(process.env.OZON_PRODUCT_RUNTIME + '/modules/tsd/ozon-packing-suggestion.js').ozonPackingSuggestions : sourceSuggestions;
afterEach(() => vi.unstubAllEnvs());
const directions = [{name:'Краснодар',items:[{skuId:'sku',barcode:'123',quantity:1}]},{name:'Москва',items:[{skuId:'sku',barcode:'123',quantity:2}]}];
function fixture() {
 for(const flag of ['WMS_FBO_TWO_STAGE_ENABLED','WMS_OZON_FBO_IMPORT_ENABLED','WMS_FBO_PARALLEL_PACKING_ENABLED','WMS_OZON_PACK_BY_PRODUCT_ENABLED'])vi.stubEnv(flag,'true');
 let data:any={units:[1,2].map(n=>({id:'u'+n,requestItemId:'i',skuId:'sku',barcode:'123',markId:'m'+n,state:'PICKED',targetBoxId:null})),boxes:[],actions:{},moves:0};
 const tx:any={$queryRaw:async()=>[],ozonFboShipment:{findUnique:async()=>({directions})},
 fboAssembly:{findUnique:async()=>({phase:'PICKING',compositionHash:createHash('sha256').update(JSON.stringify([['i','sku','123',3]])).digest('hex')})},
 fboAssemblyUnit:{findMany:async()=>data.units,update:async({where,data:d})=>Object.assign(data.units.find(u=>u.id===where.id),d)},
 fboAssemblyBox:{findMany:async()=>data.boxes,findUnique:async({where})=>data.boxes.find(b=>b.activeBoxId===where.activeBoxId),count:async({where})=>data.boxes.filter(b=>b.boxId===where.boxId).length,create:async({data:d})=>{data.boxes.push(d);return d;}},
 fboAssemblyAction:{findUnique:async({where})=>data.actions[where.id],create:async({data:d})=>{data.actions[d.id]=d;}},
 box:{findUniqueOrThrow:async()=>({id:'holding'})},stockBalance:{count:async()=>0},productMark:{count:async()=>0,updateMany:async()=>({count:1})},auditLog:{create:async()=>{}}};
 let tail=Promise.resolve();const prisma={$transaction:(fn)=>{const next=tail.then(async()=>{const before=structuredClone(data);try{return await fn(tx);}catch(e){data=before;throw e;}});tail=next.catch(()=>{});return next;}};
 const s:any=new FboTwoStageService(prisma as any,{} as any,{} as any,{} as any,{assertStockMovementsAllowed:async()=>{}} as any,{} as any);
 s.load=async()=>({id:'r',status:'IN_WORK',items:[{id:'i',skuId:'sku',barcode:'123',quantity:3}]});s.requireFbo=()=>{};s.requireIdleBox=async()=>{};
 s.target=s.box=async(_tx,_r,code)=>({id:code,code});s.exactMark=async(_tx,kiz)=>({id:kiz});s.move=async()=>{data.moves++;return {id:'movement'};};s.plan=async()=>data;
 const pack=(op='operation-1',kiz='m1',direction='Краснодар',box='FFL_ONE')=>(s.executeAction ?? s.act).call(s,'r',{action:'PACK_PRODUCT',operationId:op,barcode:'123',kiz,direction,targetBoxCode:box},{id:'worker'});
 return {s,tx,pack,get:()=>data};
}
it('prefers an open box, stable destination order, excludes closed and fulfilled destinations',()=>{
 const units=[{skuId:'sku',state:'PICKED'}];assert.equal(ozonPackingSuggestions(directions,[],units)[0].direction,'Краснодар');
 const boxes=[{boxId:'b',boxCode:'FFL_B',direction:'Москва'},{boxId:'a',boxCode:'FFL_A',direction:'Москва'}];
 assert.equal(ozonPackingSuggestions(directions,boxes,units)[0].targetBoxCode,'FFL_A');
 assert.equal(ozonPackingSuggestions(directions,boxes.map(b=>({...b,closedAt:new Date()})),units)[0].direction,'Краснодар');
 assert.equal(ozonPackingSuggestions(directions,[{boxId:'k',direction:'Краснодар',closedAt:new Date()}],[...units,{skuId:'sku',state:'PACKED',targetBoxId:'k'}])[0].direction,'Москва');
 assert.deepEqual(ozonPackingSuggestions(directions,[],[{skuId:'sku',state:'RETURNED'}]),[]);
});
it('creates carton and packs once, identical replay does not duplicate',async()=>{
 const f=fixture();await f.pack();assert.equal(f.get().moves,1);assert.equal(f.get().boxes[0].direction,'Краснодар');assert.equal(f.get().units[0].state,'PACKED');
 await f.pack();assert.equal(f.get().moves,1);await assert.rejects(()=>f.pack('operation-1','m2'),/Номер операции/);
});
it('wrong destination does not move a unit',async()=>{
 const f=fixture();f.get().boxes.push({requestId:'r',boxId:'FFL_ONE',activeBoxId:'FFL_ONE',direction:'Москва'});
 await assert.rejects(()=>f.pack(),/указанного направления/);assert.equal(f.get().moves,0);
});
it('historical closed carton cannot reopen',async()=>{
 const f=fixture();f.get().boxes.push({requestId:'r',boxId:'FFL_ONE',activeBoxId:null,direction:'Краснодар',closedAt:new Date()});
 await assert.rejects(()=>f.pack(),/новый пустой короб/);assert.equal(f.get().moves,0);
});
it('wrong or previously packed KIZ rolls back new box',async()=>{
 const f=fixture();await assert.rejects(()=>f.pack('operation-bad','absent'),/Единица не отобрана/);assert.equal(f.get().boxes.length,0);
 await f.pack();await assert.rejects(()=>f.pack('operation-new','m1','Москва','FFL_TWO'),/Единица не отобрана/);assert.equal(f.get().boxes.length,1);
});
it('serialized concurrent workers cannot exceed last unit quota',async()=>{
 const f=fixture();const results=await Promise.allSettled([f.pack(),f.pack('operation-2','m2','Краснодар','FFL_TWO')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.get().moves,1);assert.equal(f.get().boxes.length,1);
 await f.pack('operation-3','m2','Москва','FFL_TWO');assert.equal(f.get().moves,2);
});
it('disabled flag rejects new action',async()=>{
 const f=fixture();vi.stubEnv('WMS_OZON_PACK_BY_PRODUCT_ENABLED','false');await assert.rejects(()=>f.pack(),/недоступна/);assert.equal(f.get().moves,0);
});
