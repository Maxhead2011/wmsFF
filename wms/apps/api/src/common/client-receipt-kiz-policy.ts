import { BadRequestException } from '@nestjs/common';
export const clientReceiptKizPolicyKey=(clientId:string)=>'client.receipt-kiz-required.v1:'+clientId;
export async function clientRequiresReceiptKiz(db:any,clientId:string):Promise<boolean>{// FIX: explicit client policy, independent of catalog metadata.
 if(process.env.WMS_KIZ_CLIENT_GUARD_ENABLED!=='true')return false;
 const setting=await db.systemSetting?.findUnique({where:{key:clientReceiptKizPolicyKey(clientId)}});
 return setting?.value?.required===true;}
export async function clientReceiptMarking(db:any,clientId:string){return await clientRequiresReceiptKiz(db,clientId)?{needsChestnyZnak:true,isUnmarked:false}:{};}
export async function assertClientReceiptKiz(db:any,clientId:string,kiz?:string|null){if(await clientRequiresReceiptKiz(db,clientId)&&!kiz?.trim())throw new BadRequestException('Для этого клиента КИЗ обязателен для каждой единицы. Сканируйте КИЗ.');}
