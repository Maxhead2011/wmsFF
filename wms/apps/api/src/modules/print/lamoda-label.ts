import { BadRequestException } from '@nestjs/common';
import bwipjs = require('bwip-js');
import pdfMake = require('pdfmake');
import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import { configurePdfMake } from '../../common/pdf/pdfmake';
import { lamodaCareImages, lamodaEacImage } from './lamoda-label-symbols';
import { createRequire } from 'node:module';

export type LamodaLabel = {barcode:string;article:string;brand:string;name:string;color:string;size:string;composition:string;importer:string;manufacturer:string;origin:string;manufacturedAt:string;care:string[];eac:boolean};
const MM=72/25.4;
// FIX: require the supplied label data; never replace composition/date with WB guesses.
export function validateLamodaLabel(raw:any):LamodaLabel {
 const labels:Record<string,string>={barcode:'ШК Lamoda',article:'артикул Lamoda',brand:'бренд',name:'название',color:'цвет',size:'размер',composition:'состав',importer:'импортёр и адрес',manufacturer:'производитель',origin:'страна и адрес производства',manufacturedAt:'дата изготовления'};
 const missing=Object.keys(labels).filter(k=>typeof raw?.[k]!=='string'||!raw[k].trim());
 if(missing.length)throw new BadRequestException('Для этикетки Lamoda заполните: '+missing.map(k=>labels[k]).join(', '));
 if(!/^\d{8,14}$/.test(raw.barcode)||!/^\d{2}\.\d{2}\.\d{4}$/.test(raw.manufacturedAt))throw new BadRequestException('Проверьте ШК Lamoda и дату изготовления.');
 const [day,month,year]=raw.manufacturedAt.split('.').map(Number),date=new Date(Date.UTC(year,month-1,day));
 if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day||Object.keys(labels).some(k=>raw[k].length>600))throw new BadRequestException('Проверьте дату изготовления и длину полей этикетки.');
 if(!Array.isArray(raw.care)||!raw.care.length||raw.care.some((x:string)=>!lamodaCareImages[x])||typeof raw.eac!=='boolean')throw new BadRequestException('Проверьте знаки ухода и EAC в образце Lamoda.');
 return Object.fromEntries([...Object.keys(labels).map(k=>[k,raw[k].trim()]),['care',raw.care],['eac',raw.eac]]) as LamodaLabel;
}
// FIX: reflow complete text for 58x40, instead of shrinking the old 58x60 image.
export async function buildLamodaLabelPdf(raw:LamodaLabel):Promise<Buffer> {
 const r=validateLamodaLabel(raw);configurePdfMake();
 const barcode=bwipjs.toSVG({bcid:'code128',text:r.barcode,height:8,includetext:false});
 for(const fontSize of [5.6,5.3,5]) {
  const content:any[]=[
   {text:r.brand,alignment:'center',fontSize:6},
   {text:r.name.replace(/_/g,' '),bold:true,fontSize:6.2,alignment:'center'},
   {columns:[{width:'*',stack:[{text:'Артикул: '+r.article},{text:'Цвет: '+r.color}]},{width:15,text:r.size,bold:true,fontSize:10},...(r.eac?[{width:14,image:lamodaEacImage,height:14}]:[])]},
   {text:'Состав: '+r.composition},{text:'Импортёр: '+r.importer},{text:'Производитель: '+r.manufacturer},
   {text:'Сделано в: '+r.origin},{text:'Дата изготовления: '+r.manufacturedAt},
   {svg:barcode,width:48*MM,height:6.3*MM,alignment:'center',margin:[0,1,0,0]},
   {text:r.barcode,fontSize:6.5,alignment:'center'},
   {columns:[{width:'*',text:''},...r.care.map(k=>({width:10,image:lamodaCareImages[k],height:10})),{width:'*',text:''}]},
  ];
  const pdf=Buffer.from(await pdfMake.createPdf({pageSize:{width:58*MM,height:40*MM},pageMargins:[1.5*MM,1*MM,1.5*MM,1*MM],defaultStyle:{font:'DejaVuSans',fontSize,lineHeight:0.93},content}).getBuffer());
  if((await PDFDocument.load(pdf)).getPageCount()===1)return pdf;
 }
 throw new BadRequestException('Полные данные Lamoda не помещаются на 58 × 40 мм. Проверьте длину полей; текст не обрезан.');
}
export async function lamodaLabelImage(pdf:Buffer) {
 const parser=new PDFParse({data:pdf});try{
  const r=await parser.getScreenshot({desiredWidth:696,imageDataUrl:false,imageBuffer:true});
  if(r.pages.length!==1||!r.pages[0]?.data)throw new Error('Некорректная этикетка Lamoda.');
  // FIX: use pdf-lib's existing PNG codec; thermal monochrome keeps full 305-dpi geometry.
  const codec=createRequire(require.resolve('pdf-lib'))('@pdf-lib/upng').default;
  const b=Buffer.from(r.pages[0].data),decoded=codec.decode(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  const rgba=codec.toRGBA8(decoded)[0],pixels=new Uint8Array(rgba);
  for(let i=0;i<pixels.length;i+=4){const alpha=pixels[i+3]/255;const gray=(pixels[i]*0.299+pixels[i+1]*0.587+pixels[i+2]*0.114)*alpha+255*(1-alpha);pixels[i]=pixels[i+1]=pixels[i+2]=gray<180?0:255;pixels[i+3]=255;}
  return Buffer.from(codec.encode([rgba],decoded.width,decoded.height,0)).toString('base64');
 }finally{await parser.destroy();}
}
