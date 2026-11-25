import {BadRequestException} from '@nestjs/common';
import {lamodaLabelKey} from './lamoda-label.service';
import {validateLamodaLabel,type LamodaLabel} from './lamoda-label';
export type LamodaBatchInput={skuId:string;composition:string;manufacturer:string;origin:string;manufacturedAt:string};
export type LamodaLabelDraft=LamodaLabel&{skuId:string;model:string};
// FIX: defaults are suggestions only; batch-specific values are stored with the assembly.
export async function lamodaLabelDrafts(db:any,clientId:string,skus:any[],cards:any[]):Promise<LamodaLabelDraft[]|undefined> {
 if(process.env.WMS_LAMODA_ENABLED!=='true')return;
 const profile=(await db.systemSetting.findUnique({where:{key:lamodaLabelKey(clientId)}}))?.value;
 if(!profile?.enabled)return;
 if(profile.clientId!==clientId)throw new BadRequestException('Профиль Lamoda принадлежит другому клиенту.');
 return skus.map(s=>{
  const matches=cards.filter(c=>c.skuId===s.id&&c.isPresent&&c.linkState==='CONFIRMED');
  if(matches.length!==1)throw new BadRequestException('Уточните соответствие Lamoda для '+s.name);
  const card=matches[0],r=profile.records?.[card.barcode];
  if(r&&(r.article!==card.remoteSku||r.barcode!==card.barcode))throw new BadRequestException('Обновите данные карточки Lamoda для '+s.name);
  const draft={...profile.defaults,...r,barcode:card.barcode,article:card.remoteSku,
   brand:r?.brand||s.brand||'',name:r?.name||s.name||card.name,color:r?.color||s.color||'',size:r?.size||s.size||card.size||'',
   composition:r?.composition||'',manufacturer:r?.manufacturer||'',origin:r?.origin||'',manufacturedAt:r?.manufacturedAt||''};
  return {...draft,skuId:s.id,model:draft.name.replace(/[_\s]+(?:\d{2,3}|[2-5]?XL|XS|S|M|L)$/i,'').replace(/_/g,' ')};
 });
}
export function freezeLamodaBatchLabels(drafts:LamodaLabelDraft[]|undefined,inputs:LamodaBatchInput[]|undefined,confirmed:boolean|undefined){
 if(!drafts)return undefined;
 if(!confirmed||!inputs||inputs.length!==drafts.length||new Set(inputs.map(x=>x.skuId)).size!==inputs.length)throw new BadRequestException('Заполните и подтвердите данные этикеток для каждого вида костюма.');
 return drafts.map(d=>{const input=inputs.find(i=>i.skuId===d.skuId);if(!input)throw new BadRequestException('Нет данных партии для '+d.name);
  const fullLabel=validateLamodaLabel({...d,composition:input.composition,manufacturer:input.manufacturer,origin:input.origin,manufacturedAt:input.manufacturedAt});
  return {skuId:d.skuId,barcode:d.barcode,article:d.article,name:d.name,size:d.size,fullLabel};
 });
}
