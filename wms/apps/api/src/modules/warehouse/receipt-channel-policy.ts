import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;
export const receiptChannelsEnabled = () => process.env.WMS_RECEIPT_CHANNELS_ENABLED === 'true';
const prefix = (clientId: string) => `receipt.channels.v1:${clientId}:`;
export const receiptOrderKey = (t: { marketplace?: string; connectionId: string; orderId: string }) => `${t.marketplace || 'WILDBERRIES'}:${t.connectionId}:${t.orderId}`;
export type ReceiptRule = { id: string; clientId: string; warehouseId: string; sourceDocument: string;
  fbs: boolean; fbo: boolean; protectedOrders: string[]; changedAt: string; revision: number; stockAvailable?: boolean };
type Receipt = { id: string; clientId: string; warehouseId: string; sourceDocument: string; date: string;
  boxes: Array<{ id: string; code: string; status: string; receiptDocument?: string }>; received: number; current: boolean; lastActivity: string };
export const receiptSeries = (code:string,at:Date) => `SERIES:${at.getUTCFullYear()}:${code.replace(/_[0-9]+$/, '')}`;
const idFor = (client: string, warehouse: string, document: string) => createHash('sha256').update(JSON.stringify([client,warehouse,document])).digest('hex').slice(0,32);

// FIX: one client/branch/year/box series includes every TSD session and future boxes.
export async function receiptDocuments(db: Db, clientId: string, warehouseId: string, since?: Date): Promise<Receipt[]> {
  const movements = await db.stockMovement.findMany({where:{clientId,warehouseId,type:'RECEIPT',quantity:{gt:0},boxId:{not:null},
    },
    select:{boxId:true,sourceDocument:true,createdAt:true,quantity:true},orderBy:{createdAt:'desc'}});
  const openings = await db.tsdOperation.findMany({where:{operationType:{in:['receipt_open_box','receipt_box_status']},status:'ACCEPTED',
    AND:[{payload:{path:['clientId'],equals:clientId}},{payload:{path:['warehouseId'],equals:warehouseId}}]},
    select:{payload:true,createdAt:true,operationType:true},orderBy:{createdAt:'desc'}});
  const boxes = await db.box.findMany({where:{clientId,warehouseId,OR:[{id:{in:[...new Set(movements.flatMap(m=>m.boxId?[m.boxId]:[]))]}},{code:{in:[...new Set(openings.map(o=>String((o.payload as any)?.boxCode||''))) ]}}]},select:{id:true,code:true,status:true}});
  const assignments=await receiptAssignments(db,clientId,warehouseId);
  const byCode = new Map(boxes.map(b=>[b.code,b]));
  const byId = new Map(boxes.map(b=>[b.id,b]));
  const latest = new Map<string,{document:string;at:Date}>();
  for(const m of movements) if(m.boxId&&!latest.has(m.boxId))latest.set(m.boxId,{document:m.sourceDocument||`BOX:${m.boxId}`,at:m.createdAt});
  for(const o of openings){const p=o.payload as Record<string,unknown>;const box=byCode.get(String(p.boxCode));
    if(!box||typeof p.sourceDocument!=='string'||!p.sourceDocument)continue;
    if(!latest.has(box.id)||o.createdAt>latest.get(box.id)!.at)latest.set(box.id,{document:p.sourceDocument,at:o.createdAt});}
  const groups = new Map<string,Receipt>();
  for(const box of boxes){const evidence=latest.get(box.id);if(!evidence)continue;
    const series=assignments.get(box.id)?.series||receiptSeries(box.code,evidence.at);
    const id=idFor(clientId,warehouseId,series);
    const group=groups.get(id)||{id,clientId,warehouseId,sourceDocument:series,date:evidence.at.toISOString(),boxes:[],received:0,current:false,lastActivity:evidence.at.toISOString()};
    group.boxes.push({...box,receiptDocument:evidence.document});if(evidence.at.toISOString()>group.lastActivity)group.lastActivity=evidence.at.toISOString();
    group.current ||= evidence.at>=new Date(Date.now()-86400000);
    if(evidence.at.toISOString()<group.date)group.date=evidence.at.toISOString();groups.set(id,group);}
  for(const m of movements){if(!m.boxId)continue;const document=m.sourceDocument||`BOX:${m.boxId}`;
    if(latest.get(m.boxId)?.document!==document)continue;
    const box=byId.get(m.boxId);if(!box)continue;const row=groups.get(idFor(clientId,warehouseId,assignments.get(box.id)?.series||receiptSeries(box.code,m.createdAt)));if(row)row.received+=m.quantity;}
  return [...groups.values()].filter(g=>g.current||!since||new Date(g.date)>=since).sort((a,b)=>Number(b.current)-Number(a.current)||b.lastActivity.localeCompare(a.lastActivity));
}

export async function receiptRules(db: Db, clientId: string, warehouseId?: string | null) {
  if(!receiptChannelsEnabled())return new Map<string,ReceiptRule>();
  const saved=await db.systemSetting.findMany({where:{key:{startsWith:prefix(clientId)}},select:{value:true}});
  const policies=saved.map(s=>s.value as unknown as ReceiptRule).filter(s=>s.clientId===clientId&&(!warehouseId||s.warehouseId===warehouseId));
  const result=new Map<string,ReceiptRule>();
  for(const rule of policies){
    const match=/^SERIES:(\d{4}):(.+)$/.exec(rule.sourceDocument);if(!match)continue;
    const year=Number(match[1]),series=match[2];
    const boxes=await db.box.findMany({where:{clientId,warehouseId:rule.warehouseId,
      OR:[{code:series},{code:{startsWith:series+'_'}}],status:{notIn:['deleted','archived']}},select:{id:true,code:true}});
    if(!boxes.length)continue;
    const latest=await db.stockMovement.findMany({where:{clientId,warehouseId:rule.warehouseId,type:'RECEIPT',quantity:{gt:0},boxId:{in:boxes.map(b=>b.id)}},orderBy:{createdAt:'desc'},distinct:['boxId'],select:{boxId:true,createdAt:true}});
    const dates=new Map(latest.map(m=>[m.boxId,m.createdAt]));
    for(const box of boxes)if(receiptSeries(box.code,dates.get(box.id)||new Date(`${year}-01-01`))===rule.sourceDocument)result.set(box.id,rule);
  }
  const assignments=await receiptAssignments(db,clientId,warehouseId);
  for(const [box,assignment] of assignments){result.delete(box);const rule=policies.find(p=>p.sourceDocument===assignment.series&&p.warehouseId===assignment.warehouseId);if(rule)result.set(box,rule);}
  // FIX: approval is independent of channel permissions and cannot be bypassed by protected orders.
  for(const entry of await receiptApprovalEntries(db,clientId,warehouseId))if(!entry.approval.available){
    for(const box of entry.doc.boxes){const saved=result.get(box.id);result.set(box.id,{id:entry.doc.id,clientId,warehouseId:entry.doc.warehouseId,sourceDocument:entry.doc.sourceDocument,fbs:true,fbo:true,protectedOrders:[],changedAt:'',revision:0,...saved,stockAvailable:false});}
  }
  return result;
}

export function receiptAllows(rule: ReceiptRule | undefined, channel:'fbs'|'fbo', task?: {marketplace?:string;connectionId:string;orderId:string}) {
  return rule?.stockAvailable!==false && (!rule || rule[channel] || (channel==='fbs'&&!!task&&rule.protectedOrders.includes(receiptOrderKey(task))));
}
export async function receiptBlockedBoxes(db: Db, clientId: string, channel:'fbs'|'fbo', taskId?: string, identity?:{marketplace?:string;connectionId:string;orderId:string}) {
  if(!receiptChannelsEnabled())return [] as string[];
  const task=identity||(taskId?await db.fbsTsdAssembly.findUnique({where:{id:taskId},select:{marketplace:true,connectionId:true,orderId:true}}):null);
  return [...await receiptRules(db,clientId)].filter(([,rule])=>!receiptAllows(rule,channel,task||undefined)).map(([id])=>id);
}
// FIX: protected demand is fulfilled from excluded receipts and must not also
// reserve the ordinary stock which is still allowed for new FBS orders.
export async function receiptPublicationPolicy(db:Db,clientId:string,warehouseId?:string|null,override?:Map<string,ReceiptRule>){
  const rules=override||await receiptRules(db,clientId,warehouseId);
  const blocked=[...rules].filter(([,r])=>!r.fbs||r.stockAvailable===false).map(([id])=>id);
  const credit=new Map<string,number>();if(!blocked.length)return {blocked,credit};
  const requests=await db.clientRequest.findMany({where:{clientId,...(warehouseId?{warehouseId}:{}),status:{notIn:['DONE','CANCELLED','REJECTED']}},select:{id:true}});
  const tasks=await db.fbsTsdAssembly.findMany({where:{clientId,marketplace:'WILDBERRIES',requestId:{in:requests.map(r=>r.id)},status:{in:['WAITING_STOCK','RESERVED','IN_PROGRESS','RESCAN_REQUIRED']},
    ...(warehouseId?{OR:[{stockWarehouseId:warehouseId},{stockWarehouseId:null}]}:{})},
    select:{id:true,marketplace:true,connectionId:true,orderId:true,requestId:true,skuId:true,sourceSkuId:true,relabelConfirmedAt:true,itemCount:true,boxId:true,reservedBoxId:true}});
  const stock=await db.stockBalance.findMany({where:{clientId,boxId:{in:blocked},status:'AVAILABLE',quantity:{gt:0}},select:{boxId:true,skuId:true,quantity:true}});
  const movements=await db.stockMovement.findMany({where:{clientId,sourceDocument:{in:[...new Set(tasks.map(t=>t.requestId))]},status:'PACKING',idempotencyKey:{startsWith:'fbs-sticker-pick:'}},select:{idempotencyKey:true,quantity:true}});
  const picked=new Map<string,number>();for(const m of movements){const id=m.idempotencyKey!.slice(17).split(':')[0];picked.set(id,(picked.get(id)||0)+m.quantity);}
  for(const t of [...tasks].sort((a,b)=>Number(!!(b.boxId||b.reservedBoxId))-Number(!!(a.boxId||a.reservedBoxId)))){let remaining=Math.max(0,Math.max(1,t.itemCount)-(picked.get(t.id)||0));
    const sku=t.sourceSkuId&&!t.relabelConfirmedAt?t.sourceSkuId:t.skuId;
    const candidates=stock.filter(b=>b.boxId&&(!(t.boxId||t.reservedBoxId)||b.boxId===(t.boxId||t.reservedBoxId))&&b.skuId===sku&&receiptAllows(rules.get(b.boxId),'fbs',t));
    candidates.sort((a,b)=>Number(b.boxId===(t.boxId||t.reservedBoxId))-Number(a.boxId===(t.boxId||t.reservedBoxId)));
    for(const b of candidates){const take=Math.min(b.quantity,remaining);b.quantity-=take;remaining-=take;credit.set(t.skuId,(credit.get(t.skuId)||0)+take);if(!remaining)break;}
  }
  return {blocked,credit};
}
export async function assertReceiptFbsBox(db: Db, task: {id?:string;clientId:string;boxId?:string|null;marketplace?:string;connectionId:string;orderId:string}, boxId=task.boxId) {
  if(!receiptChannelsEnabled()||!boxId)return;
  const rule=(await receiptRules(db,task.clientId)).get(boxId);
  if(rule?.stockAvailable===false)throw new ConflictException('Приёмка на согласовании. Сначала подтвердите доступ в остатках.');
  if(!receiptAllows(rule,'fbs',task))throw new ConflictException('Приёмка предназначена только для ФБО. Этот новый заказ ФБС нельзя отобрать из её коробов.');
}

async function existingOrders(db: Db, clientId: string, warehouseId: string) {
  const requests=await db.clientRequest.findMany({where:{clientId,warehouseId,status:{notIn:['DONE','CANCELLED','REJECTED']}},select:{id:true}});
  const requestIds=requests.map(r=>r.id);
  const [tasks,links]=await Promise.all([
    db.fbsTsdAssembly.findMany({where:{clientId,requestId:{in:requestIds},status:{in:['WAITING_STOCK','RESERVED','IN_PROGRESS','RESCAN_REQUIRED','RETURN_REQUIRED']}},select:{marketplace:true,connectionId:true,orderId:true}}),
    db.fbsOrderRequestLink.findMany({where:{clientId,requestId:{in:requestIds},syncStatus:'ACTIVE',OR:[{lastCategory:null},{lastCategory:{notIn:['shipped','archive','cancelled']}}]},select:{marketplace:true,connectionId:true,orderId:true}}),
  ]);
  return [...new Set([...tasks,...links].map(receiptOrderKey))];
}

// FIX: the same preview is recalculated under the serializable save transaction.
export async function receiptChannelChange(db: Db, clientId:string,warehouseId:string,id:string,fbs:boolean,fbo:boolean,revision:number,save:boolean,userId:string) {
  if(!receiptChannelsEnabled())throw new NotFoundException('Направления приёмки выключены.');
  if(typeof fbs!=='boolean'||typeof fbo!=='boolean'||!Number.isSafeInteger(revision))throw new BadRequestException('Укажите направления ФБС/ФБО и версию записи.');
  if(!fbs&&!fbo)throw new BadRequestException('Выберите хотя бы одно направление: ФБС или ФБО.');
  const doc=(await receiptDocuments(db,clientId,warehouseId)).find(d=>d.id===id);
  if(!doc)throw new NotFoundException('Приёмка не найдена в выбранном филиале.');
  const key=prefix(clientId)+id;
  const stored=await db.systemSetting.findUnique({where:{key}});
  const previous=stored?.value as unknown as ReceiptRule|undefined;
  if((previous?.revision||0)!==revision)throw new ConflictException('Направления уже изменены. Обновите список приёмок.');
  const protectedOrders=!fbs?(previous&&!previous.fbs?previous.protectedOrders:await existingOrders(db,clientId,warehouseId)):[];
  const rule:ReceiptRule={id,clientId,warehouseId,sourceDocument:doc.sourceDocument,fbs,fbo,protectedOrders,revision:revision+1,changedAt:new Date().toISOString()};
  const balances=await db.stockBalance.findMany({where:{clientId,warehouseId,boxId:{in:doc.boxes.map(b=>b.id)},status:'AVAILABLE',quantity:{gt:0}},select:{skuId:true,quantity:true}});
  const requests=await db.clientRequest.findMany({where:{clientId,warehouseId,status:{notIn:['DONE','CANCELLED','REJECTED']}},select:{id:true}});
  const tasks=await db.fbsTsdAssembly.findMany({where:{clientId,requestId:{in:requests.map(r=>r.id)},status:{in:['WAITING_STOCK','RESERVED','IN_PROGRESS','RESCAN_REQUIRED','RETURN_REQUIRED','COMPLETED']},
    OR:[{stockWarehouseId:warehouseId},{stockWarehouseId:null},{boxId:{in:doc.boxes.map(b=>b.id)}},{reservedBoxId:{in:doc.boxes.map(b=>b.id)}}]},
    select:{id:true,requestId:true,marketplace:true,connectionId:true,orderId:true,skuId:true,sourceSkuId:true,relabelConfirmedAt:true,itemCount:true}});
  const pickedRows=tasks.length?await db.stockMovement.findMany({where:{clientId,sourceDocument:{in:requests.map(r=>r.id)},status:'PACKING',idempotencyKey:{startsWith:'fbs-sticker-pick:'}},select:{idempotencyKey:true,quantity:true}}):[];
  const picked=new Map<string,number>();for(const m of pickedRows){const taskId=m.idempotencyKey!.slice('fbs-sticker-pick:'.length).split(':')[0];picked.set(taskId,(picked.get(taskId)||0)+m.quantity);}
  const pending=tasks.map(t=>({...t,itemCount:Math.max(0,Math.max(1,t.itemCount)-Math.max(0,picked.get(t.id)||0))}));
  const unassigned=await receiptUnassignedOrders(db,clientId,warehouseId,new Set(tasks.map(receiptOrderKey)));
  const quantities=new Map<string,number>();for(const b of balances)quantities.set(b.skuId,(quantities.get(b.skuId)||0)+b.quantity);
  const demand=new Map<string,number>();for(const t of [...pending,...unassigned])if(protectedOrders.includes(receiptOrderKey(t))){const sku=t.sourceSkuId&&!t.relabelConfirmedAt?t.sourceSkuId:t.skuId;demand.set(sku,(demand.get(sku)||0)+t.itemCount);}
  const available=balances.reduce((s,b)=>s+b.quantity,0),protectedQuantity=[...quantities].reduce((s,[sku,qty])=>s+Math.min(qty,demand.get(sku)||0),0);
  if(!fbo&&await db.fboAssemblyUnit.count({where:{sourceBoxId:{in:doc.boxes.map(b=>b.id)},state:{not:'RETURNED'},assembly:{phase:{not:'COMPLETED'}}}}))
    throw new ConflictException('Часть приёмки уже отобрана в ФБО. Завершите её обработку перед отключением ФБО.');
  if(save){await db.systemSetting.upsert({where:{key},create:{key,value:rule as unknown as Prisma.InputJsonValue,updatedByUserId:userId},update:{value:rule as unknown as Prisma.InputJsonValue,updatedByUserId:userId}});
    await receiptStockSyncEvent(db,clientId);
    await db.auditLog.create({data:{userId,action:'RECEIPT_CHANNELS_CHANGED',entity:'Receipt',entityId:id,payload:{clientId,warehouseId,sourceDocument:doc.sourceDocument,previous:previous as unknown as Prisma.InputJsonValue||null,next:rule as unknown as Prisma.InputJsonValue,protectedQuantity,excludedQuantity:fbs?0:available-protectedQuantity}}});}
  return {rule,available,protectedQuantity,excludedQuantity:fbs?0:available-protectedQuantity,protectedOrders:protectedOrders.length};
}

export function requireReceiptChannelAdmin(user:{roleCodes:string[];activeWarehouseId?:string|null;writableWarehouseIds?:string[];warehouseIds?:string[]}) {
  if(!user.roleCodes.some(r=>['ADMIN','OWNER'].includes(r)))throw new ForbiddenException('Направления приёмки доступны администратору и собственнику.');
  if(!user.activeWarehouseId)throw new BadRequestException('Выберите филиал.');
  if(!user.roleCodes.includes('OWNER')&&user.writableWarehouseIds&&!user.writableWarehouseIds.includes(user.activeWarehouseId))throw new ForbiddenException('Нет права изменять приёмки этого филиала.');
  return user.activeWarehouseId;
}

// FIX: routes that predate assembly creation still protect their stock from FBO.
export async function receiptUnassignedOrders(db:Db,clientId:string,warehouseId:string|null,known:Set<string>){
  if(!receiptChannelsEnabled())return [];
  const rows=await db.fbsOrderRequestLink.findMany({where:{clientId,syncStatus:'ACTIVE',
    OR:[{lastCategory:null},{lastCategory:{notIn:['shipped','archive','cancelled']}}],
    request:{warehouseId,status:{notIn:['DONE','CANCELLED','REJECTED']}}},
    select:{marketplace:true,connectionId:true,orderId:true,lastSkuId:true,lastItemCount:true}});
  const missing=rows.filter(r=>!known.has(receiptOrderKey(r)));
  if(missing.some(r=>!r.lastSkuId))throw new ConflictException('У активного заказа ещё не определён товар. Обновите заказы ФБС перед изменением направлений или отбором ФБО.');
  const result=missing.map(r=>({...r,skuId:r.lastSkuId!,sourceSkuId:null as string|null,relabelConfirmedAt:null,boxId:null,reservedBoxId:null,itemCount:Math.max(1,r.lastItemCount||1)}));
  if(!missing.length)return result;
  const skus=await db.sku.findMany({where:{clientId,id:{in:missing.map(r=>r.lastSkuId!)}},select:{id:true,article:true,clientSku:true,size:true}});
  const mappings=await db.clientArticleMapping.findMany({where:{clientId},select:{sourceArticle:true,targetArticle:true}});
  const normalize=(v:string|null)=>v?.trim().toLocaleLowerCase('ru-RU')||'';
  for(const row of [...result]){
    const target=skus.find(s=>s.id===row.skuId);if(!target)continue;
    const articles=mappings.filter(m=>[normalize(target.article),normalize(target.clientSku)].includes(normalize(m.targetArticle))).map(m=>m.sourceArticle);
    if(!articles.length)continue;
    const sources=await db.sku.findMany({where:{clientId,...(target.size?{size:{equals:target.size,mode:'insensitive' as const}}:{}),
      OR:articles.flatMap(article=>[{article:{equals:article,mode:'insensitive' as const}},{clientSku:{equals:article,mode:'insensitive' as const}},{internalSku:{equals:article,mode:'insensitive' as const}},{internalSku:{startsWith:article+'-',mode:'insensitive' as const}}])},select:{id:true}});
    for(const source of sources)if(source.id!==row.skuId)result.push({...row,sourceSkuId:source.id});
  }
  return result;
}

async function receiptAssignments(db:Db,clientId:string,warehouseId?:string|null){
  const rows=await db.systemSetting.findMany({where:{key:{startsWith:`receipt.membership.v1:${clientId}:`}},select:{value:true}});
  return new Map<string,{series:string;warehouseId:string}>(rows.map(r=>r.value as any).filter(r=>r.clientId===clientId&&(!warehouseId||r.warehouseId===warehouseId)).map(r=>[r.boxId,{series:r.series,warehouseId:r.warehouseId}]));
}
export async function assignReceiptBox(db:Db,clientId:string,warehouseId:string,receiptId:string,boxCode:string,userId:string,save:boolean){
  if(!receiptChannelsEnabled())throw new NotFoundException();
  const receipt=(await receiptDocuments(db,clientId,warehouseId)).find(r=>r.id===receiptId);
  const box=await db.box.findFirst({where:{clientId,warehouseId,code:boxCode.trim(),status:{not:'deleted'}},select:{id:true,code:true}});
  if(!receipt||!box)throw new NotFoundException('Приёмка или короб не найдены в этом филиале.');
  const key=`receipt.membership.v1:${clientId}:${box.id}`;
  const previous=await db.systemSetting.findUnique({where:{key}});
  const target=await db.systemSetting.findUnique({where:{key:prefix(clientId)+receiptId}});
  const policy=target?.value as unknown as ReceiptRule|undefined;
  if(policy&&!policy.fbo&&await db.fboAssemblyUnit.count({where:{sourceBoxId:box.id,state:{not:'RETURNED'},assembly:{phase:{not:'COMPLETED'}}}}))throw new ConflictException('Короб уже участвует в отборе ФБО. Сначала завершите его обработку.');
  if(save){
    if(policy&&!policy.fbs){const updated={...policy,protectedOrders:[...new Set([...policy.protectedOrders,...await existingOrders(db,clientId,warehouseId)])],revision:policy.revision+1,changedAt:new Date().toISOString()};
      await db.systemSetting.update({where:{key:prefix(clientId)+receiptId},data:{value:updated as unknown as Prisma.InputJsonValue,updatedByUserId:userId}});}
    const value={clientId,warehouseId,boxId:box.id,series:receipt.sourceDocument};
    await db.systemSetting.upsert({where:{key},create:{key,value,updatedByUserId:userId},update:{value,updatedByUserId:userId}});
    await receiptStockSyncEvent(db,clientId);
    await db.auditLog.create({data:{userId,action:'RECEIPT_BOX_ASSIGNED',entity:'Box',entityId:box.id,payload:{previous:previous?.value||null,next:value}}});}
  return {boxCode:box.code,series:receipt.sourceDocument,fbs:policy?.fbs??true,fbo:policy?.fbo??true};
}
// FIX: forbid mixing stock across incompatible receipt directions during box transfers.
export async function assertReceiptTransfer(db:Db,clientId:string,from:string,to:string){
  if(!receiptChannelsEnabled())return;
  const rules=await receiptRules(db,clientId),a=rules.get(from),b=rules.get(to);
  if(a?.stockAvailable===false||b?.stockAvailable===false)throw new ConflictException('Приёмка на согласовании. Перенос товара возможен после подтверждения доступа в остатках.');
  if((a?.fbs??true)!==(b?.fbs??true)||(a?.fbo??true)!==(b?.fbo??true)||JSON.stringify(a?.protectedOrders||[])!==JSON.stringify(b?.protectedOrders||[]))
    throw new ConflictException('У коробов разные направления приёмки ФБС/ФБО. Сначала отнесите короб назначения к той же приёмке.');
}

export async function filterReceiptOrderBoxes<T extends {id:string;marketplace:string;connectionId:string;storageBoxes:Array<{code:string}>}>(db:Db,clientId:string,orders:T[]):Promise<T[]>{
  const rules=await receiptRules(db,clientId);if(!rules.size)return orders;
  const boxes=await db.box.findMany({where:{id:{in:[...rules.keys()]}},select:{id:true,code:true}});
  const byCode=new Map(boxes.map(b=>[b.code,rules.get(b.id)]));
  return orders.map(o=>({...o,storageBoxes:o.storageBoxes.filter(b=>receiptAllows(byCode.get(b.code),'fbs',{...o,orderId:o.id}))}));
}

export async function receiptBlockedByTasks(db:Db,clientId:string,ids:string[]){
  const result=new Map<string,string[]>();if(!receiptChannelsEnabled()||!ids.length)return result;
  const rules=await receiptRules(db,clientId);if(!rules.size)return result;
  const tasks=await db.fbsTsdAssembly.findMany({where:{clientId,id:{in:ids}},select:{id:true,marketplace:true,connectionId:true,orderId:true}});
  for(const task of tasks)result.set(task.id,[...rules].filter(([,rule])=>!receiptAllows(rule,'fbs',task)).map(([id])=>id));
  return result;
}

// FIX: durable event invalidates in-flight WB plans and survives an API restart.
// The queue exists only in the explicitly enabled our-WMS stock-sync runtime.
export async function receiptStockSyncEvent(db:Db,clientId:string){
  if(!receiptChannelsEnabled()||process.env.WMS_WB_URGENT_STOCK_SYNC!=='true')return;
  await db.$executeRaw`INSERT INTO "WbStockSyncEvent" ("clientId","skuIds","allSkus") VALUES (${clientId},ARRAY[]::text[],true)`;
}

// FIX: opt-in approval filters availability, never physical balances or storage billing.
export const receiptApprovalEnabled=()=>process.env.WMS_RECEIPT_APPROVAL_ENABLED==='true';
export const receiptApprovalScopeKey=(clientId:string,warehouseId:string)=>`receipt.approval.scope.v1:${clientId}:${warehouseId}`;
export const receiptApprovalKey=(clientId:string,warehouseId:string,id:string)=>`receipt.approval.v1:${clientId}:${warehouseId}:${id}`;
type ApprovalScope={clientId:string;warehouseId:string;grandfatheredReceiptIds:string[];revision?:number};
type Approval={available:boolean;revision:number;changedAt?:string;changedByName?:string;changedByUserId?:string};
export function receiptApprovalState(id:string,scope:Pick<ApprovalScope,'grandfatheredReceiptIds'>|null,saved:Approval|null):Approval {
  return saved??{available:!scope||scope.grandfatheredReceiptIds.includes(id),revision:0};
}
export async function receiptApprovalEntries(db:Db,clientId:string,warehouseId?:string|null,documents?:Receipt[]){
  if(!receiptApprovalEnabled())return [] as Array<{doc:Receipt;approval:Approval}>;
  const scopes=await db.systemSetting.findMany({where:{key:{startsWith:`receipt.approval.scope.v1:${clientId}:`}},select:{key:true,value:true}});
  const selected=scopes.filter(s=>{const v=s.value as unknown as ApprovalScope;return v.clientId===clientId&&(!warehouseId||v.warehouseId===warehouseId);});
  if(!selected.length)return [];
  // A save takes the exclusive lock and bumps the scope revision. Picks retain this shared lock until commit.
  await db.$queryRaw(Prisma.sql`SELECT key FROM "SystemSetting" WHERE key IN (${Prisma.join(selected.map(s=>s.key))}) ORDER BY key FOR SHARE`);
  const out:Array<{doc:Receipt;approval:Approval}>=[];
  for(const s of selected){const scope=s.value as unknown as ApprovalScope;
    const docs=documents?.filter(d=>d.warehouseId===scope.warehouseId)??await receiptDocuments(db,clientId,scope.warehouseId);
    const saved=await db.systemSetting.findMany({where:{key:{startsWith:`receipt.approval.v1:${clientId}:${scope.warehouseId}:`}},select:{key:true,value:true}});
    const byKey=new Map(saved.map(row=>[row.key,row.value as unknown as Approval]));
    for(const doc of docs)out.push({doc,approval:receiptApprovalState(doc.id,scope,byKey.get(receiptApprovalKey(clientId,scope.warehouseId,doc.id))??null)});
  }return out;
}
export async function pendingReceiptBoxIds(db:Db,clientIds:string[],warehouseId?:string|null){
  if(!receiptApprovalEnabled())return [] as string[];
  const ids:string[]=[];for(const clientId of [...new Set(clientIds)])for(const row of await receiptApprovalEntries(db,clientId,warehouseId))if(!row.approval.available)ids.push(...row.doc.boxes.map(b=>b.id));
  return [...new Set(ids)];
}
export async function assertReceiptStockAvailable(db:Db,clientId:string,boxIds:string[],warehouseId?:string|null){
  if(!boxIds.length||!receiptApprovalEnabled())return;
  const pending=new Set(await pendingReceiptBoxIds(db,[clientId],warehouseId));
  if(boxIds.some(id=>pending.has(id)))throw new ConflictException('Приёмка на согласовании. Товар недоступен для отбора до подтверждения клиента.');
}
export async function changeReceiptApproval(db:Db,input:{clientId:string;warehouseId:string;id:string;available:boolean;revision:number},user:{id:string;name:string;roleCodes:string[]},save:boolean){
  if(!receiptApprovalEnabled())throw new NotFoundException('Согласование приёмок не включено.');
  if(typeof input.available!=='boolean'||!Number.isSafeInteger(input.revision)||input.revision<0)throw new BadRequestException('Укажите доступность и версию приёмки.');
  const admin=user.roleCodes.some(r=>['ADMIN','OWNER'].includes(r));
  if(!admin&&!input.available)throw new ForbiddenException('Отключать доступ в остатках может только администратор.');
  const scopeKey=receiptApprovalScopeKey(input.clientId,input.warehouseId);
  if(save)await db.$queryRaw`SELECT key FROM "SystemSetting" WHERE key=${scopeKey} FOR UPDATE`;
  const scope=await db.systemSetting.findUnique({where:{key:scopeKey}});if(!scope)throw new NotFoundException('Согласование не включено для этого клиента и филиала.');
  const entry=(await receiptApprovalEntries(db,input.clientId,input.warehouseId)).find(e=>e.doc.id===input.id);
  if(!entry)throw new NotFoundException('Приёмка не найдена в выбранном филиале.');
  if(entry.approval.revision!==input.revision)throw new ConflictException('Приёмка уже изменена. Обновите список.');
  if(!input.available){const boxes=entry.doc.boxes.map(b=>b.id),open={status:{notIn:['DONE','CANCELLED','REJECTED'] as any}};
    const [selections,tasks,units]=await Promise.all([
      db.clientRequestBoxSelection.findMany({where:{boxId:{in:boxes},requestItem:{request:open}},select:{requestItem:{select:{requestId:true}}}}),
      db.fbsTsdAssembly.findMany({where:{clientId:input.clientId,status:{in:['RESERVED','IN_PROGRESS','RESCAN_REQUIRED','RETURN_REQUIRED','COMPLETED']},OR:[{boxId:{in:boxes}},{reservedBoxId:{in:boxes}}]},select:{requestId:true}}),
      db.fboAssemblyUnit.findMany({where:{sourceBoxId:{in:boxes},state:{not:'RETURNED'},assembly:{request:open}},select:{requestId:true}}),
    ]);
    const ids=[...new Set([...selections.map(s=>s.requestItem.requestId),...tasks.map(t=>t.requestId),...units.map(u=>u.requestId)])];
    const requests=await db.clientRequest.findMany({where:{id:{in:ids},...open},select:{number:true}});
    if(requests.length)throw new ConflictException(`Товар занят заявками: ${requests.map(r=>'№'+r.number).join(', ')}. Сначала освободите резерв.`);
    if(tasks.some(t=>t.requestId.startsWith('AUTO:')))throw new ConflictException('Товар зарезервирован заказами ФБС. Сначала освободите резерв.');
  }
  const next:Approval={available:input.available,revision:input.revision+1,changedAt:new Date().toISOString(),changedByName:user.name,changedByUserId:user.id};
  if(save){const key=receiptApprovalKey(input.clientId,input.warehouseId,input.id);
    await db.systemSetting.upsert({where:{key},create:{key,value:next as unknown as Prisma.InputJsonValue,updatedByUserId:user.id},update:{value:next as unknown as Prisma.InputJsonValue,updatedByUserId:user.id}});
    await db.systemSetting.update({where:{key:scopeKey},data:{value:{...(scope.value as any),revision:Number((scope.value as any).revision||0)+1},updatedByUserId:user.id}});
    await db.auditLog.create({data:{userId:user.id,action:'RECEIPT_STOCK_ACCESS_CHANGED',entity:'Receipt',entityId:input.id,payload:{clientId:input.clientId,warehouseId:input.warehouseId,sourceDocument:entry.doc.sourceDocument,previous:entry.approval as unknown as Prisma.InputJsonValue,next:next as unknown as Prisma.InputJsonValue}}});
    await receiptStockSyncEvent(db,input.clientId);
  }return {approval:next,sourceDocument:entry.doc.sourceDocument};
}
