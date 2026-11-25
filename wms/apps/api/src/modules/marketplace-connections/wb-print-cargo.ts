import {BadRequestException} from '@nestjs/common';
import {withWbShippingLock} from './wb-shipping-workflow';
import {wbShippingEnabled} from './wb-shipping-points';
import {buildFbsCargoPlaceStickersPdf} from './fbs-stickers-pdf';
type Json=(url:string,init:RequestInit)=>Promise<any>;
function cargoIds(value:any):string[]{
 if(!Array.isArray(value?.trbxes)||value.trbxes.some((x:any)=>!x?.id))throw new BadRequestException('WB не подтвердил список грузомест.');
 const ids=value.trbxes.map((x:any)=>String(x.id));if(new Set(ids).size!==ids.length)throw new BadRequestException('WB вернул повторяющиеся грузоместа.');return ids;
}
// FIX: reuse remote cargo; create only missing cargo on explicit printing, never ship or fake packing.
export async function wbPrintCargo(host:any,clientId:string,orders:any[],user:any,json:Json,createMissing:boolean){
 if(!orders.length||orders.some(o=>o.marketplace!=='WILDBERRIES'||!o.supplyId))throw new BadRequestException('Выберите поставку WB.');
 const connections=await host.loadSelectedConnections(clientId,orders),stickers:any[]=[];
 const supplies=[...new Map(orders.map(o=>[JSON.stringify([o.connectionId,o.supplyId]),o])).values()];
 for(const supply of supplies){
  const connection=connections.find((c:any)=>c.id===supply.connectionId);if(!connection)throw new BadRequestException('Кабинет WB недоступен.');
  const path=`/api/v3/supplies/${encodeURIComponent(supply.supplyId)}`;
  const request=(p:string,init:RequestInit={})=>json('https://marketplace-api.wildberries.ru'+p,{...init,method:init.method??'GET',headers:{Authorization:connection.apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});
  const read=()=>request(path+'/trbx').then(cargoIds);
  let ids=await read();
  if(!ids.length&&createMissing){
   host.clientScopes.requireClientAccess(user,clientId,'write');
   if(!wbShippingEnabled())throw new BadRequestException('Автосоздание грузомест WB не включено.');
   ids=await withWbShippingLock(host,supply.connectionId,supply.supplyId,async()=>{
    let current=await read();if(current.length)return current;
    const plan=await host.prisma.fbsSupplyPlan.findFirst({where:{clientId,connectionId:supply.connectionId,supplyId:supply.supplyId,marketplace:'WILDBERRIES'}});
    if(!plan||plan.deliveryDestination!=='PICKUP_POINT')throw new BadRequestException(`Для ${supply.supplyId} не задано направление ПВЗ. Грузоместа автоматически не создавались.`);
    const details=await request(path);if(details.id!==supply.supplyId||details.done||details.scanDt)throw new BadRequestException(`Поставка ${supply.supplyId} уже закрыта или её состояние не подтверждено WB.`);
    const members=await request(`/api/marketplace/v3/supplies/${encodeURIComponent(supply.supplyId)}/order-ids`);
    if(!Array.isArray(members.orderIds)||!members.orderIds.length||orders.filter(o=>o.connectionId===supply.connectionId&&o.supplyId===supply.supplyId).some(o=>!members.orderIds.map(String).includes(o.id)))throw new BadRequestException('WB не подтвердил состав поставки.');
    const pending=await host.prisma.auditLog.findFirst({where:{entity:'FbsSupplyPlan',entityId:plan.id,action:'WB_CARGO_CREATE_PENDING'},orderBy:{createdAt:'desc'}});
    const confirmed=pending?await host.prisma.auditLog.findFirst({where:{entity:'FbsSupplyPlan',entityId:plan.id,action:'WB_CARGO_CREATE_CONFIRMED',createdAt:{gte:pending.createdAt}}}):null;
    if(pending&&!confirmed)throw new BadRequestException('Результат предыдущего создания грузомест не подтверждён. Повторное создание остановлено до сверки WB.');
    const target=plan.cargoPlaceCount>0?plan.cargoPlaceCount:1;
    if(!Number.isInteger(target)||target<1||target>Math.floor(members.orderIds.length/2))throw new BadRequestException(`В поставке ${supply.supplyId} ${members.orderIds.length} заказов: WB не разрешает создать ${target} грузомест. Проверьте состав поставки.`);
    await host.prisma.auditLog.create({data:{userId:user.id,action:'WB_CARGO_CREATE_PENDING',entity:'FbsSupplyPlan',entityId:plan.id,payload:{target,previousIds:[],supplyId:supply.supplyId,source:'print'}}});
    try{await request(path+'/trbx',{method:'POST',body:JSON.stringify({amount:target})});}catch{current=await read();if(current.length!==target)throw new BadRequestException('WB не подтвердил создание грузомест. Повторное создание заблокировано до сверки.');}
    current=await read();if(current.length!==target)throw new BadRequestException('WB ещё не подтвердил итоговое количество грузомест. Повторите печать после сверки.');
    await host.prisma.fbsSupplyPlan.update({where:{id:plan.id},data:{cargoPlaceIds:current,cargoPlaceCount:current.length}});
    await host.prisma.auditLog.create({data:{userId:user.id,action:'WB_CARGO_CREATE_CONFIRMED',entity:'FbsSupplyPlan',entityId:plan.id,payload:{supplyId:supply.supplyId,cargoPlaceIds:current,source:'print'}}});
    return current;
   });
  }
  if(!ids.length)throw new BadRequestException(`В поставке ${supply.supplyId} нет грузомест. Нажмите печать, чтобы создать их автоматически.`);
  const result=await request(path+'/trbx/stickers?type=png',{method:'POST',body:JSON.stringify({trbxIds:ids})});
  if(!Array.isArray(result.stickers)||result.stickers.length!==ids.length||result.stickers.some((s:any)=>!s.file||!s.barcode))throw new BadRequestException(`WB не вернул полный комплект стикеров грузомест ${supply.supplyId}.`);
  stickers.push(...result.stickers.map((s:any,i:number)=>({orderId:`${supply.supplyId}-${i+1}`,barcode:String(s.barcode),file:s.file})));
 }
 return {buffer:await buildFbsCargoPlaceStickersPdf(stickers)};
}
