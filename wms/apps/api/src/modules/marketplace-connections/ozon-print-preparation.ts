import {BadRequestException, ConflictException} from '@nestjs/common';

type Selection={connectionId:string;id:string};
type Json=(url:string,init:RequestInit)=>Promise<any>;
const enabled=()=>process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED==='true';
const key=(clientId:string,connectionId:string,orderId:string)=>'ozon.print-preparation.v1:'+JSON.stringify([clientId,connectionId,orderId]);
function composition(posting:any) {
 if(!Array.isArray(posting.products)||!posting.products.length)throw new BadRequestException('Ozon не вернул состав заказа.');
 const rows=posting.products.map((p:any)=>({product_id:Number(p.sku),quantity:p.quantity}));
 if(rows.some((p:any)=>!Number.isSafeInteger(p.product_id)||p.product_id<1||!Number.isSafeInteger(p.quantity)||p.quantity<1)||new Set(rows.map((p:any)=>p.product_id)).size!==rows.length)
  throw new BadRequestException('Некорректный состав заказа Ozon.');
 return rows.sort((a:any,b:any)=>a.product_id-b.product_id);
}
// FIX: a preparation intent is separate from physical picking and survives a lost Ozon response.
export async function isOzonPrintPrepared(db:any,clientId:string,connectionId:string,orderId:string,posting:any,requestId?:string) {
 if(!enabled()||posting.status!=='awaiting_deliver')return false;
 const saved=await db.systemSetting.findUnique({where:{key:key(clientId,connectionId,orderId)}});
 try{return !!saved?.value?.requestId&&(!requestId||saved.value.requestId===requestId)&&JSON.stringify(saved.value.products)===JSON.stringify(composition(posting));}catch{return false;}
}
export async function decorateOzonPrintPrepared(db:any,clientId:string,orders:any[]) {
 if(!enabled())return;
 const candidates=orders.filter(o=>o.marketplace==='OZON'&&o.supplierStatus==='awaiting_deliver');
 if(!candidates.length)return;
 const records=await db.systemSetting.findMany({where:{key:{in:candidates.map(o=>key(clientId,o.connectionId,o.id))}}});
 const byKey=new Map(records.map((r:any)=>[r.key,r.value]));
 for(const o of candidates){const saved:any=byKey.get(key(clientId,o.connectionId,o.id));if(saved?.requestId&&saved.requestId===o.request?.id)o.ozonPrintPrepared=true;}
}
export async function hasOzonPrintPreparation(db:any,clientId:string,connectionId:string,orderId:string,requestId:string){
 if(!enabled())return false;
 return (await db.systemSetting.findUnique({where:{key:key(clientId,connectionId,orderId)}}))?.value?.requestId===requestId;
}
// FIX: only the explicit print action may prepare Ozon; no fabricated scans, stock or completed tasks.
export async function prepareOzonPrint(db:any,clientId:string,selections:Selection[],user:{id:string;activeWarehouseId?:string|null},json:Json){
 if(!enabled())throw new BadRequestException('Подготовка этикеток до отбора не включена.');
 // Same advisory identities as the published manual/background assembly lock.
 return db.$transaction(async(tx:any)=>{
  for(const id of [...new Set(selections.map(s=>`${s.connectionId}:${s.id}`))].sort()){
   const lockKey=`fbs-assembly:${clientId}:${id}`;
   const rows=await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked`;
   if(!rows[0]?.locked)throw new ConflictException('Для выбранного заказа уже выполняется подготовка. Повторите печать позже.');
  }
  return prepareUnlocked(db,clientId,selections,user,json);
 },{timeout:600000,maxWait:5000});
}
async function prepareUnlocked(db:any,clientId:string,selections:Selection[],user:{id:string;activeWarehouseId?:string|null},json:Json){
 const selected=[...new Map(selections.map(s=>[JSON.stringify([s.connectionId,s.id]),s])).values()];
 if(!selected.length||selected.length>1000)throw new BadRequestException('Выберите заказы Ozon.');
 const connections=await db.clientMarketplaceConnection.findMany({where:{clientId,isActive:true,id:{in:[...new Set(selected.map(s=>s.connectionId))]}}});
 if(connections.length!==new Set(selected.map(s=>s.connectionId)).size||connections.some((c:any)=>c.marketplace!=='OZON'||!c.sellerId))throw new BadRequestException('Кабинет Ozon не найден.');
 const links=await db.fbsOrderRequestLink.findMany({where:{clientId,marketplace:'OZON',OR:selected.map(s=>({connectionId:s.connectionId,orderId:s.id}))},include:{request:{select:{status:true,warehouseId:true}}}});
 const plans=[];
 // Preflight every selected order before the first remote mutation.
 for(const s of selected){
  const c=connections.find((c:any)=>c.id===s.connectionId);
  const l=links.find((l:any)=>l.connectionId===s.connectionId&&l.orderId===s.id);
  if(!l||l.syncStatus!=='ACTIVE'||!['SUBMITTED','IN_REVIEW','APPROVED','IN_WORK','PACKED'].includes(l.request.status)||!user.activeWarehouseId||l.request.warehouseId!==user.activeWarehouseId)
   throw new BadRequestException(`Заказ ${s.id} недоступен в открытой заявке выбранного филиала.`);
  const headers={'Client-Id':c.sellerId,'Api-Key':c.apiKey,'Content-Type':'application/json'};
  const response=await json('https://api-seller.ozon.ru/v3/posting/fbs/get',{method:'POST',headers,body:JSON.stringify({posting_number:s.id,with:{barcodes:true}})});
  const posting=response.result??response;
  if(posting.posting_number!==s.id)throw new BadRequestException('Ozon вернул другой номер заказа.');
  if(!['awaiting_packaging','awaiting_deliver'].includes(posting.status))throw new BadRequestException(`Заказ ${s.id} уже передан или недоступен для сборки.`);
  if(posting.is_multibox)throw new BadRequestException(`Заказ ${s.id} требует отдельной проверки мест.`);
  const products=composition(posting);
  plans.push({s,headers,posting,products,requestId:l.requestId,requiresPhysicalSubmission:!!posting.requirements?.products_requiring_mandatory_mark?.length});
 }
 for(const plan of plans){
  const {s,headers,posting,products,requestId}=plan;
  if(posting.status==='awaiting_packaging'&&!plan.requiresPhysicalSubmission){
   const value={requestId,products,preparedBy:user.id,preparedAt:new Date().toISOString()};
   const settingKey=key(clientId,s.connectionId,s.id);
   await db.systemSetting.upsert({where:{key:settingKey},create:{key:settingKey,value},update:{value}});
   await db.auditLog.create({data:{userId:user.id,action:'OZON_LABEL_PREPARATION_REQUESTED',entity:'ClientRequest',entityId:requestId,payload:{orderId:s.id,connectionId:s.connectionId,products}}});
   await json('https://api-seller.ozon.ru/v4/posting/fbs/ship',{method:'POST',headers,body:JSON.stringify({posting_number:s.id,packages:[{products}],with:{additional_data:true}})});
  }
 }
 const requiresPhysicalSubmission=plans.filter(p=>p.requiresPhysicalSubmission&&p.posting.status==='awaiting_packaging').map(p=>p.s);
 return {prepared:plans.length-requiresPhysicalSubmission.length,orderIds:plans.filter(p=>!requiresPhysicalSubmission.includes(p.s)).map(p=>p.s.id),requiresPhysicalSubmission};
}
