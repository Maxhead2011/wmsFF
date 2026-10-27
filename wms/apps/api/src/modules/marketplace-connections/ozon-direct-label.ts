import {BadRequestException} from '@nestjs/common';

// FIX: only selected Ozon postings; no cross-marketplace refresh or billing sync.
export async function selectedOzonLabels(db:any, clientId:string,
 selections:Array<{connectionId:string;id:string}>,
 json:(url:string,init:RequestInit)=>Promise<Record<string,unknown>>,
 binary:(url:string,init:RequestInit)=>Promise<{buffer:Buffer;contentType:string}>) {
 if(process.env.WMS_OZON_DIRECT_LABEL_ENABLED!=='true'||!selections.length)return null;
 const unique=[...new Map(selections.map(s=>[JSON.stringify([s.connectionId,s.id]),s])).values()];
 const ids=[...new Set(unique.map(s=>s.connectionId))];
 const connections=await db.clientMarketplaceConnection.findMany({where:{id:{in:ids},clientId,isActive:true},select:{id:true,marketplace:true,sellerId:true,apiKey:true}});
 if(connections.length!==ids.length)throw new BadRequestException('Подключение выбранного кабинета не найдено или отключено.');
 if(connections.some((c:any)=>c.marketplace!=='OZON'))return null;
 const parts:Buffer[]=[];
 for(const c of connections){
  if(!c.sellerId)throw new BadRequestException('В подключении Ozon не заполнен Client-Id.');
  const headers={'Client-Id':c.sellerId,'Api-Key':c.apiKey,'Content-Type':'application/json'};
  const orders=unique.filter(s=>s.connectionId===c.id);
  for(const order of orders){
   const data=await json('https://api-seller.ozon.ru/v3/posting/fbs/get',{method:'POST',headers,body:JSON.stringify({posting_number:order.id}),signal:AbortSignal.timeout(20000)});
   const posting=(data.result??data) as Record<string,unknown>;
   if(posting.posting_number!==order.id)throw new BadRequestException('Ozon вернул другой номер заказа.');
   if(!['awaiting_deliver','arbitration','delivering','delivered'].includes(String(posting.status)))throw new BadRequestException(`Этикетка заказа ${order.id} недоступна: сначала передайте сборку Ozon.`);
  }
  for(let i=0;i<orders.length;i+=20){
   const label=await binary('https://api-seller.ozon.ru/v2/posting/fbs/package-label',{method:'POST',headers:{...headers,Accept:'application/pdf'},body:JSON.stringify({posting_number:orders.slice(i,i+20).map(s=>s.id)}),signal:AbortSignal.timeout(30000)});
   parts.push(label.buffer);
  }
 }
 return {parts,count:unique.length};
}
