import {BadRequestException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PDFParse} from 'pdf-parse';
import type {SupplyIntegration} from './ozon-supply-policy';

// FIX: only a complete, unique set of confirmed cargoes can enter one print job.
export function ozonPrintManifest(directions:Array<{name:string}>, link:SupplyIntegration|null) {
 if(!link||!directions.length)throw new BadRequestException('Сначала передайте все грузоместа в Ozon.');
 const supplies=directions.map(d=>{
  const id=link.mapping[d.name],op=link.operations[id];
  if(!id||op?.state!=='SUCCESS'||!op.cargoes?.length)throw new BadRequestException(`Грузоместа направления «${d.name}» ещё не подтверждены.`);
  return {id,name:d.name,cargoIds:op.cargoes.map(c=>c.cargoId)};
 });
 const ids=supplies.flatMap(s=>s.cargoIds);
 if(new Set(supplies.map(s=>s.id)).size!==supplies.length||new Set(ids).size!==ids.length||ids.some(id=>!/^\d+$/.test(id)))throw new BadRequestException('Неоднозначное соответствие грузомест. Проверьте результат отправки.');
 if(ids.length>500)throw new BadRequestException('В одной серии допускается не более 500 грузомест.');
 return {supplies,total:ids.length,fingerprint:createHash('sha256').update(JSON.stringify(supplies)).digest('hex')};
}

// FIX: check identity, not only page count; preserve official artwork and aspect ratio.
export async function renderOzonPrintPages(buffer:Buffer,cargoIds:string[]) {
 const parser=new PDFParse({data:new Uint8Array(buffer)});
 try {
  const text=await parser.getText();
  if(text.pages.length!==cargoIds.length)throw new BadRequestException('Количество этикеток Ozon не совпадает с грузоместами. Печать не начата.');
  const values=text.pages.map(page=>{
   const compact=page.text.replace(/\s/g,'');
   const matches=cargoIds.filter(id=>compact.includes(id));
   if(matches.length!==1)throw new BadRequestException('Не удалось однозначно проверить номер грузоместа на этикетке.');
   return matches[0];
  });
  if(new Set(values).size!==cargoIds.length)throw new BadRequestException('Ozon вернул повторные этикетки. Печать не начата.');
  const rendered=await parser.getScreenshot({scale:203/72,imageDataUrl:false,imageBuffer:true});
  let ratio=0;
  const pages=rendered.pages.map((page,index)=>{
   const b=Buffer.from(page.data),w=b.readUInt32BE(16),h=b.readUInt32BE(20);
   if(index===0)ratio=w/h;
   if(w<100||w>2000||h<100||h>3000||Math.abs(w/h-ratio)>.01)throw new BadRequestException('Разные форматы этикеток Ozon в одной серии.');
   return {value:values[index],imageBase64:b.toString('base64')};
  });
  if(pages.length!==cargoIds.length)throw new BadRequestException('Подготовлены не все страницы этикеток.');
  return {widthMm:120,heightMm:Math.round(120/ratio),pages};
 }finally{await parser.destroy();}
}
