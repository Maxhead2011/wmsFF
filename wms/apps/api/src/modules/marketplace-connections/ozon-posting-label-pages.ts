import {BadRequestException} from '@nestjs/common';
import {PDFDocument} from 'pdf-lib';
import {PDFParse} from 'pdf-parse';
const compact=(s:unknown)=>String(s??'').replace(/\s+/g,'');
// FIX: Ozon's own PDF may contain product barcode pages; only proven shipment labels belong to cargo mode.
export async function ozonPostingLabelPages(buffer:Buffer,postings:Record<string,any>[]){
 const parser=new PDFParse({data:buffer});let texts:string[];
 try{texts=(await parser.getText()).pages.map(p=>compact(p.text));}finally{await parser.destroy();}
 const matches=postings.map(p=>{const keys=[p.posting_number,p.scanit,p.barcodes?.upper_barcode,p.barcodes?.lower_barcode].map(compact).filter(Boolean);return texts.flatMap((t,i)=>keys.some(k=>t.includes(k))?[i]:[]);});
 if(!postings.length||matches.some(p=>!p.length))throw new BadRequestException('В PDF Ozon не удалось подтвердить стикеры всех выбранных отправлений. Печать грузомест остановлена, чтобы не выдать неверный комплект.');
 const indices=[...new Set(matches.flat())].sort((a,b)=>a-b),source=await PDFDocument.load(buffer);
 if(texts.length!==source.getPageCount())throw new BadRequestException('Не удалось проверить страницы PDF Ozon.');
 const output=await PDFDocument.create();(await output.copyPages(source,indices)).forEach(p=>output.addPage(p));return Buffer.from(await output.save());
}
