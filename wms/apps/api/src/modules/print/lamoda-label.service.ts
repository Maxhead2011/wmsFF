import { BadRequestException } from '@nestjs/common';
import { validateLamodaLabel, type LamodaLabel } from './lamoda-label';
export const lamodaLabelKey=(clientId:string)=>`lamoda.label-profile.v1:${clientId}`;
// FIX: use only a current confirmed mapping in the same client, never names or sizes as a join.
export async function readLamodaLabel(db:any,clientId:string,skuId:string,barcode?:string,article?:string,snapshot?:LamodaLabel,requireSnapshot=false):Promise<LamodaLabel|null> {
 if(process.env.WMS_LAMODA_ENABLED!=='true')return null;
 if(snapshot){const saved=validateLamodaLabel(snapshot);if(saved.barcode!==barcode||saved.article!==article)throw new BadRequestException('Сохранённая этикетка не соответствует товару заявки.');return saved;}
 const profile=(await db.systemSetting.findUnique({where:{key:lamodaLabelKey(clientId)}}))?.value;
 if(!profile?.enabled)return null;
 if(requireSnapshot)throw new BadRequestException('Заполните и сохраните данные в форме переклейки Lamoda перед печатью.');
 if(profile.clientId!==clientId)throw new BadRequestException('Профиль этикеток Lamoda принадлежит другому клиенту.');
 const cards=await db.lamodaProduct.findMany({where:{skuId,isPresent:true,linkState:'CONFIRMED',...(barcode?{barcode}:{}),account:{clientId,isActive:true}},select:{barcode:true,remoteSku:true}});
 if(cards.length!==1||!cards[0].barcode)throw new BadRequestException('Подтвердите однозначную привязку товара к ШК Lamoda.');
 const card=cards[0],raw=profile.records?.[card.barcode];
 if(!raw)throw new BadRequestException(`Для ШК Lamoda ${card.barcode} нет полных данных этикетки. Добавьте состав, производителя, адреса, дату изготовления и знаки ухода из образца.`);
 const value=validateLamodaLabel(raw);
 if(value.barcode!==card.barcode||value.article!==card.remoteSku||(article&&value.article!==article))throw new BadRequestException('Данные этикетки расходятся с артикулом или ШК подтверждённой карточки Lamoda.');
 return value;
}
