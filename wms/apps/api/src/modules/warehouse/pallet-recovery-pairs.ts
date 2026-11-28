import {BadRequestException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {storageBoxTransferKizIdentity as parseKiz} from '../stock/stock-operations.service';
export const palletRecoveryPairsEnabled=()=>process.env.WMS_TSD_PALLET_RECOVERY_PAIRS_ENABLED==='true';
export type RecoveryPair={skuId:string;barcode:string;kiz:string;identity:string;gtin:string};
// FIX: quantity is physical unique pairs, never a manually supplied counter.
export function parseRecoveryPairs(value:unknown):RecoveryPair[]{
 if(!Array.isArray(value)||!value.length||value.length>200)throw new BadRequestException('Сканируйте пары ШК + КИЗ: от 1 до 200 единиц.');
 const seen=new Set<string>();return value.map(row=>{
  if(!row||typeof row!=='object'||typeof row.skuId!=='string'||!row.skuId.trim()||typeof row.barcode!=='string'||!row.barcode.trim()||typeof row.kiz!=='string'||row.kiz.length>1024||Number(row.quantity)!==1)throw new BadRequestException('Каждая единица должна содержать ШК товара и один КИЗ.');
  const p=parseKiz(row.kiz.trim());if(!p)throw new BadRequestException('Сканируйте полный КИЗ после ШК товара.');
  const identity=`01${p.gtin}21${p.serial}`;if(seen.has(identity))throw new BadRequestException('Один КИЗ отсканирован повторно. Количество не увеличено.');seen.add(identity);
  return {skuId:row.skuId.trim(),barcode:row.barcode.trim(),kiz:row.kiz.trim(),identity,gtin:p.gtin};
 });
}
export async function restorePairedPalletBox(db:any,pallet:any,boxCode:string,key:string,raw:unknown,user:any,balances:any){
 const pairs=parseRecoveryPairs(raw);const fingerprint=createHash('sha256').update(JSON.stringify(pairs.map(p=>[p.skuId,p.barcode,p.identity]).sort())).digest('hex');
 return db.$transaction(async(tx:any)=>{
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))','pallet-recovery-box:'+boxCode);
  const prior=await tx.auditLog.findFirst({where:{action:'TSD_PALLET_PAIRS_RESTORED',payload:{path:['operationKey'],equals:key}}});
  if(prior){if(prior.payload.fingerprint!==fingerprint||prior.payload.boxCode!==boxCode||prior.payload.palletId!==pallet.id)throw new BadRequestException('Ключ восстановления уже использован для другого состава.');return {box:await tx.box.findUniqueOrThrow({where:{id:prior.entityId}}),quantity:pairs.length,alreadyApplied:true};}
  const existing=await tx.box.findUnique({where:{code:boxCode}});
  if(existing&&(existing.clientId!==pallet.clientId||existing.warehouseId&&existing.warehouseId!==pallet.warehouseId))throw new BadRequestException('Короб другого клиента или филиала.');
  if(existing&&await tx.stockBalance.findFirst({where:{boxId:existing.id,quantity:{not:0}}}))throw new BadRequestException('В коробе уже есть остаток или резерв. Повторный приход запрещён.');
  const skuIds=[...new Set(pairs.map(p=>p.skuId))];const skus=await tx.sku.findMany({where:{id:{in:skuIds},clientId:pallet.clientId},include:{barcodes:true}});const marks=[];
  for(const p of [...pairs].sort((a,b)=>a.identity.localeCompare(b.identity))){
   await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))','pallet-recovery-kiz:'+p.identity);
   const sku=skus.find((s:any)=>s.id===p.skuId);if(!sku||!sku.barcodes.some((b:any)=>b.value===p.barcode))throw new BadRequestException('ШК не соответствует товару выбранного клиента.');
   const serial=p.identity.slice(18),prefixes=[p.identity,']d2'+p.identity,']D2'+p.identity,`(01)${p.gtin}(21)${serial}`,`01${p.gtin}\u001d21${serial}`,`01${p.gtin}<GS>21${serial}`];
   const found=await tx.productMark.findMany({where:{OR:prefixes.map(v=>({value:{startsWith:v}}))},take:51});
   const exact=found.filter((m:any)=>{const v=parseKiz(m.value);return v&&`01${v.gtin}21${v.serial}`===p.identity;});
   if(found.length>50||exact.length>1)throw new BadRequestException('Неоднозначная привязка КИЗ. Нужна сверка.');
   const m=exact[0];if(m&&(m.clientId!==pallet.clientId||m.skuId!==p.skuId||m.status!=='AVAILABLE'||m.boxId!==existing?.id))throw new BadRequestException('КИЗ относится к другому товару, коробу или недоступен.');
   if(!m&&!sku.barcodes.some((b:any)=>/^\d{8,14}$/.test(b.value)&&b.value.padStart(14,'0')===p.gtin))throw new BadRequestException('GTIN нового КИЗа не совпадает с товаром. Нужна сверка карточки.');
   const where={OR:prefixes.map(v=>({kiz:{startsWith:v}}))};
   if(await tx.shippedKizHistory.findFirst({where})||await tx.fbsTsdAssembly.findFirst({where})||await tx.fboAssemblyUnit.findFirst({where:{OR:[...where.OR,...(m?[{markId:m.id},{activeMarkId:m.id}]:[])]}}))throw new BadRequestException('КИЗ связан со сборкой или отгрузкой. Используйте сверку, восстановление не выполнено.');
   marks.push({pair:p,mark:m});
  }
  const box=existing?await tx.box.update({where:{id:existing.id},data:{status:'active',warehouseId:pallet.warehouseId}}):await tx.box.create({data:{code:boxCode,clientId:pallet.clientId,warehouseId:pallet.warehouseId,status:'active'}});
  // Existing zero balances may remain; upsert uses the normal warehouse balance key.
  for(const skuId of skuIds){const quantity=pairs.filter(p=>p.skuId===skuId).length;const data={clientId:pallet.clientId,warehouseId:pallet.warehouseId,skuId,boxId:box.id,palletId:null,status:'AVAILABLE'};const balanceKey=balances.balanceKey(data);
   await tx.stockBalance.upsert({where:{balanceKey},create:{...data,balanceKey,quantity},update:{quantity}});
   await tx.stockMovement.create({data:{...data,type:'INVENTORY_ADJUSTMENT',quantity,idempotencyKey:`${key}:${skuId}`,sourceDocument:`TSD паллетсорт ${pallet.code}`,comment:'Восстановление по уникальным парам ШК + КИЗ.'}});
  }
  for(const {pair:p,mark:m} of marks){if(m)await tx.productMark.update({where:{id:m.id},data:{boxId:box.id}});else await tx.productMark.create({data:{clientId:pallet.clientId,skuId:p.skuId,boxId:box.id,value:p.kiz,status:'AVAILABLE'}});}
  await tx.auditLog.create({data:{userId:user.id,action:'TSD_PALLET_PAIRS_RESTORED',entity:'Box',entityId:box.id,payload:{operationKey:key,fingerprint,boxCode,palletId:pallet.id,previousStatus:existing?.status??null,pairs,previousMarks:marks.filter(x=>x.mark).map(x=>({id:x.mark.id,boxId:x.mark.boxId,stockMovementId:x.mark.stockMovementId})),quantity:pairs.length}}});
  return {box,quantity:pairs.length,alreadyApplied:false};
 },{isolationLevel:'Serializable',timeout:30000});
}
