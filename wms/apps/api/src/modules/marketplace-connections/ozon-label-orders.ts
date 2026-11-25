import {BadRequestException} from '@nestjs/common';

type Selection={connectionId:string;id:string};
// FIX: label metadata needs only the selected postings, never client-wide history or billing sync.
// Product/barcode/marking validation remains in fabricPairedLabels before any PDF is returned.
export async function ozonLabelOrders(db:any,clientId:string,input:Selection[],json:(url:string,init:RequestInit)=>Promise<any>) {
 const selections=[...new Map(input.map(s=>[JSON.stringify([s.connectionId,s.id]),s])).values()];
 if(!selections.length)throw new BadRequestException('Выберите заказы.');
 const ids=[...new Set(selections.map(s=>s.connectionId))];
 const connections=await db.clientMarketplaceConnection.findMany({where:{clientId,isActive:true,id:{in:ids}},select:{id:true,marketplace:true,sellerId:true,apiKey:true,accountName:true}});
 if(connections.length!==ids.length)throw new BadRequestException('Подключение выбранного кабинета не найдено или отключено.');
 if(connections.some((c:any)=>c.marketplace!=='OZON'))return null;
 const orders=[];
 for(const selection of selections){
  const c=connections.find((c:any)=>c.id===selection.connectionId);
  if(!c.sellerId)throw new BadRequestException('В подключении Ozon не заполнен Client-Id.');
  const response=await json('https://api-seller.ozon.ru/v3/posting/fbs/get',{method:'POST',headers:{'Client-Id':c.sellerId,'Api-Key':c.apiKey,'Content-Type':'application/json'},body:JSON.stringify({posting_number:selection.id}),signal:AbortSignal.timeout(20000)});
  const posting=response.result??response;
  if(posting.posting_number!==selection.id)throw new BadRequestException('Ozon вернул другой номер заказа.');
  if(!['awaiting_deliver','arbitration','delivering','delivered'].includes(posting.status))throw new BadRequestException(`Ozon ещё не разрешил официальный стикер ${selection.id}. Сначала подготовьте стикеры для сборки.`);
  orders.push({...selection,marketplace:'OZON' as const,accountName:c.accountName??null,supplierStatus:posting.status,wbStatus:posting.status,
   category:posting.status==='delivered'?'archive' as const:posting.status==='delivering'?'shipped' as const:'active' as const,
   barcodes:[],product:null,itemCount:(posting.products??[]).reduce((sum:number,p:any)=>sum+Number(p.quantity||0),0),supplyId:null,crossBorderType:null,requiredMeta:[],optionalMeta:[],shipmentPlan:null});
 }
 return orders;
}
