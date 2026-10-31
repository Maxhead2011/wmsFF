import {ConflictException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
export const fboCompletionBatchEnabled=()=>process.env.WMS_FBO_COMPLETION_RELIABILITY_ENABLED==='true';

// FIX: all checks stay inside the caller's request-locked transaction; no cross-request cache.
export async function validateFboPackedBoxes(tx:any,r:any,boxes:any[],units:any[]) {
 const ids=[...new Set<string>(boxes.map(b=>b.boxId))].sort();
 if(ids.length!==boxes.length)throw new ConflictException('Повтор короба в составе поставки.');
 const expected=new Map<string,any[]>(),allowed=new Set(ids);
 for(const u of units)if(u.state==='PACKED'){
  if(!u.targetBoxId||!allowed.has(u.targetBoxId))throw new ConflictException('Товар не привязан к коробу поставки.');
  const list=expected.get(u.targetBoxId)??[];list.push(u);expected.set(u.targetBoxId,list);
 }
 // Deterministic order prevents two multi-box completions acquiring opposite box locks.
 for(let start=0;start<ids.length;start+=500){
  const part=ids.slice(start,start+500);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Box" WHERE id=ANY(${part}::text[]) ORDER BY id FOR UPDATE`);
  const physical=await tx.box.findMany({where:{id:{in:part}}});
  if(physical.length!==part.length||physical.some((b:any)=>b.clientId!==r.clientId||b.warehouseId!==r.warehouseId||b.status!=='active'))
   throw new NotFoundException('Короб недоступен в филиале и у клиента заявки.');
  const balances=await tx.stockBalance.findMany({where:{boxId:{in:part},quantity:{not:0}}});
  const marks=await tx.productMark.findMany({where:{boxId:{in:part},status:{not:'SHIPPING'}}});
  const actual=new Map<string,Map<string,number>>(),markGroups=new Map<string,any[]>();
  for(const b of balances){
   if(b.status!=='PACKING'||b.clientId!==r.clientId||b.warehouseId!==r.warehouseId)throw new ConflictException('В коробе появился посторонний остаток.');
   const group=actual.get(b.boxId)??new Map<string,number>();group.set(b.skuId,(group.get(b.skuId)??0)+b.quantity);actual.set(b.boxId,group);
  }
  for(const m of marks){const group=markGroups.get(m.boxId)??[];group.push(m);markGroups.set(m.boxId,group);}
  for(const id of part){
   const wanted=new Map<string,number>(),wantedMarks=new Map<string,string>(),list=expected.get(id)??[];
   for(const u of list){wanted.set(u.skuId,(wanted.get(u.skuId)??0)+1);if(u.markId)wantedMarks.set(u.markId,u.skuId);}
   const current=actual.get(id)??new Map();
   if(current.size!==wanted.size||[...wanted].some(([sku,n])=>current.get(sku)!==n))throw new ConflictException('Состав короба изменился после упаковки.');
   const ms=markGroups.get(id)??[];
   if(ms.length!==list.filter(u=>u.markId).length||ms.length!==wantedMarks.size||ms.some(m=>m.status!=='PACKING'||wantedMarks.get(m.id)!==m.skuId))
    throw new ConflictException('КИЗ короба изменились после упаковки.');
  }
 }
}

// FIX: aggregate once; sort only populated item groups in original line order.
export function fboCompletionPackages(r:any,boxes:any[],units:any[]) {
 const lines=new Map<string,any>(r.items.map((i:any)=>[i.id,i])),groups=new Map<string,Map<string,number>>();
 const ids=new Set(boxes.map(b=>b.boxId));
 for(const u of units)if(u.state==='PACKED'){
  if(!ids.has(u.targetBoxId)||lines.get(u.requestItemId)?.skuId!==u.skuId)throw new ConflictException('Состав заявки изменился. Обновите задание.');
  const g=groups.get(u.targetBoxId)??new Map<string,number>();g.set(u.requestItemId,(g.get(u.requestItemId)??0)+1);groups.set(u.targetBoxId,g);
 }
 const order=new Map<string,number>(r.items.map((i:any,n:number)=>[i.id,n]));
 return boxes.map(b=>({packageCode:b.boxCode,packageType:'BOX',items:[...(groups.get(b.boxId)??new Map<string,number>())]
  .sort((a,b)=>order.get(a[0])!-order.get(b[0])!).map(([requestItemId,quantity])=>({requestItemId,quantity}))}));
}
export async function saveFboCompletionSelections(tx:any,r:any,boxes:any[],packages:any[]) {
 const byCode=new Map(boxes.map(b=>[b.boxCode,b.boxId])),skus=new Map(r.items.map((i:any)=>[i.id,i.skuId]));
 const data=packages.flatMap(p=>p.items.map((i:any)=>({requestItemId:i.requestItemId,skuId:skus.get(i.requestItemId),boxId:byCode.get(p.packageCode),quantity:i.quantity})));
 await tx.clientRequestBoxSelection.deleteMany({where:{requestItem:{requestId:r.id}}});
 for(let i=0;i<data.length;i+=500)await tx.clientRequestBoxSelection.createMany({data:data.slice(i,i+500)});
}
export async function fboCompletionStage<T>(requestId:string,stage:string,action:()=>Promise<T>):Promise<T>{
 const start=Date.now();let failed=false;
 try{return await action();}catch(e){failed=true;throw e;}finally{
  if(fboCompletionBatchEnabled())console.info(JSON.stringify({event:'fbo_completion_stage',requestId,stage,durationMs:Date.now()-start,failed}));
 }
}
// FIX: callers still keep the immutable operation/preview token. Unknown outcomes are never replayed with a new key.
export function fboCompletionError(error:any):any{
 if(!fboCompletionBatchEnabled())return error;
 if(['P2028','P2034','P1001','P1002','P1017'].includes(error?.code)||error?.code==='P2010'&&['40001','40P01','57014'].includes(error?.meta?.code))
  return new ServiceUnavailableException({code:'FBO_COMPLETION_CHECK_RESULT',message:'Не удалось получить результат завершения. Обновите заявку и проверьте её состояние. Если завершение не выполнено, повторите ту же операцию; повторное списание защищено.'});
 return error;
}
// FIX: the administrative recovery implementation is runtime-owned; install only at its exact release seam.
export function installFboRecoveryReliability(prototype:any){
 const apply=prototype.apply;
 prototype.apply=async function(id:string,token:string,user:any){
  if(!fboCompletionBatchEnabled())return apply.call(this,id,token,user);
  try{return await fboCompletionStage(id,'recovery_apply',()=>apply.call(this,id,token,user));}
  catch(error){throw fboCompletionError(error);}
 };
}
