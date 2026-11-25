import {ConflictException,NotFoundException} from '@nestjs/common';
import {lamodaLabelDrafts,freezeLamodaBatchLabels,type LamodaBatchInput} from './lamoda-batch-label';
import {buildLamodaLabelPdf} from './lamoda-label';
import {readLamodaRelabelLabels} from '../tsd/lamoda-fbo-relabel';
// FIX: label details belong to relabeling an existing request, never to request creation.
export async function lamodaRelabelData(db:any,r:any,user:{id?:string},body?:{labelData:LamodaBatchInput[];confirmed:boolean}){
 if(process.env.WMS_LAMODA_ENABLED!=='true'||process.env.WMS_LAMODA_FBO_RELABEL_ENABLED!=='true')throw new NotFoundException();
 const binding=await db.lamodaFboAssembly.findUnique({where:{requestId:r.id}});if(!binding)throw new NotFoundException('Это не сборка Lamoda.');
 const labels=await readLamodaRelabelLabels(db,binding),ids=new Set(r.items.map((i:any)=>i.skuId));
 const selected=labels.filter(l=>ids.has(l.skuId));
 const skus=[...new Map(r.items.filter((i:any)=>i.sku).map((i:any)=>[i.skuId,i.sku])).values()];
 const complete=selected.length===skus.length&&selected.every(l=>!!l.fullLabel);
 const draft=complete?selected.map(l=>({...l.fullLabel!,skuId:l.skuId,model:l.fullLabel!.name.replace(/[_\s]+(?:\d{2,3}|[2-5]?XL|XS|S|M|L)$/i,'').replace(/_/g,' ')})):await lamodaLabelDrafts(db,r.clientId,skus,selected.map(l=>({skuId:l.skuId,barcode:l.barcode,remoteSku:l.article,isPresent:true,linkState:'CONFIRMED'})));
 if(!draft)return {enabled:false,saved:false,locked:false,drafts:[]};
 const drafts=draft.map(d=>({...d,...selected.find(l=>l.skuId===d.skuId)?.fullLabel}));
 const saved=selected.length===drafts.length&&selected.every(l=>!!l.fullLabel);
 const locked=!!await db.fboAssemblyUnit.count({where:{requestId:r.id,OR:[{lamodaRelabelPrintId:{not:null}},{lamodaRelabelConfirmedAt:{not:null}},{state:'PACKED'}]}});
 // FIX: do not strand older requests that already printed the previous template.
 if(locked&&!saved){if(body)throw new ConflictException('В этой заявке уже печатался прежний шаблон. Нужна отдельная сверка перед заменой данных.');return {enabled:false,saved:false,locked:true,legacy:true,drafts:[]};}
 if(!body)return {enabled:true,saved,locked,drafts};
 const next=freezeLamodaBatchLabels(drafts,body.labelData,body.confirmed)!;
 // A lost save response may be retried even after printing starts, but cannot change its data.
 const fingerprint=(rows:typeof selected)=>JSON.stringify(rows.map(l=>[l.skuId,l.fullLabel]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
 if(saved&&fingerprint(selected)===fingerprint(next))return {enabled:true,saved:true,locked,drafts};
 for(const label of next)await buildLamodaLabelPdf(label.fullLabel);
 await db.$transaction(async(tx:any)=>{
  await tx.$queryRaw`SELECT "id" FROM "ClientRequest" WHERE "id"=${r.id} FOR UPDATE`;
  const current=await tx.clientRequest.findUniqueOrThrow({where:{id:r.id},select:{clientId:true,warehouseId:true,status:true}});
  if(current.clientId!==r.clientId||current.warehouseId!==r.warehouseId||!['SUBMITTED','APPROVED','IN_WORK'].includes(current.status))throw new ConflictException('Заявка изменилась или уже завершена.');
  const b=await tx.lamodaFboAssembly.findUniqueOrThrow({where:{requestId:r.id}});
  if(JSON.stringify(await readLamodaRelabelLabels(tx,b))!==JSON.stringify(labels))throw new ConflictException('Данные переклейки изменились. Обновите форму.');
  if(await tx.fboAssemblyUnit.count({where:{requestId:r.id,OR:[{lamodaRelabelPrintId:{not:null}},{lamodaRelabelConfirmedAt:{not:null}},{state:'PACKED'}]}}))throw new ConflictException('Этикетки уже печатались. Данные переклейки менять нельзя.');
  await tx.lamodaFboAssembly.update({where:{requestId:r.id},data:{relabelLabels:next}});
  await tx.auditLog.create({data:{userId:user.id,action:'LAMODA_RELABEL_DATA_SAVED',entity:'ClientRequest',entityId:r.id,payload:{sku:next.length,fields:['composition','manufacturer','origin','manufacturedAt'],stockUnchanged:true}}});
 },{isolationLevel:'Serializable',timeout:30000});
 return {enabled:true,saved:true,locked:false,drafts:next.map((l,i)=>({...drafts[i],...l.fullLabel}))};
}
