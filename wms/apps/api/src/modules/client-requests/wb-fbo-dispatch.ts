import type {Prisma} from '@prisma/client';
import {ConflictException} from '@nestjs/common';
export const dispatchKey=(id:string)=>'wb-fbo-dispatch:v1:'+id;
// FIX: dispatch is separate from warehouse ledger completion and remains unfinished.
export async function wbDispatchContexts(db:Pick<Prisma.TransactionClient,'systemSetting'>,ids:string[]){
 const result:Record<string,string>={};if(process.env.WMS_MARKETPLACE_WORKSPACES_ENABLED!=='true'||!ids.length)return result;
 for(const row of await db.systemSetting.findMany({where:{key:{in:ids.map(dispatchKey)}}})){
  const v=row.value as {at?:string};if(typeof v?.at==='string')result[row.key.slice('wb-fbo-dispatch:v1:'.length)]=v.at;
 }return result;
}
// FIX: loading cannot be silently undone through an ordinary status dropdown.
export async function assertFboProcessChange(db:Pick<Prisma.TransactionClient,'systemSetting'>,id:string,status:string){
 if(process.env.WMS_MARKETPLACE_WORKSPACES_ENABLED!=='true')return;
 const dispatch=await db.systemSetting.findUnique({where:{key:dispatchKey(id)}});
 if(dispatch&&status!=='DONE')throw new ConflictException('Товар загружен в автомобиль. Для возврата требуется складское исправление.');
 if(status==='DONE'){
  const binding=await db.systemSetting.findUnique({where:{key:'wb-fbo-tracking:v1:'+id}});
  if(binding&&![4,5,6].includes((binding.value as {statusId:number}).statusId))throw new ConflictException('WB ещё не подтвердил сдачу. Обновите статус связанной поставки.');
 }
}
