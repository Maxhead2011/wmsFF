import type {TDocumentDefinitions} from 'pdfmake/interfaces';
import bwipjs = require('bwip-js');
import pdfMake = require('pdfmake');
import {PDFParse} from 'pdf-parse';
import {configurePdfMake} from '../../common/pdf/pdfmake';
// FIX: two distinct warehouse labels, WB-like bold identifier, no truncation of encoded codes.
export function kizBoxLabelDefinition(code:string,title:string):TDocumentDefinitions{
 if(!/^[A-Za-z0-9_-]{1,96}$/.test(code))throw new Error('Некорректный код этикетки.');
 const mm=72/25.4;
 const qr={bcid:'qrcode',text:code,scale:3,eclevel:'M'};
 const svg=bwipjs.toSVG(qr);
 return {pageSize:{width:58*mm,height:40*mm},pageMargins:0,defaultStyle:{font:'DejaVuSans',bold:true},content:[
  {text:title,fontSize:10,absolutePosition:{x:3*mm,y:2*mm}},
  {svg,width:22*mm,height:22*mm,absolutePosition:{x:18*mm,y:8*mm}},
  {text:code,fontSize:Math.min(14,135/code.length),noWrap:true,alignment:'center',margin:[3*mm,32*mm,3*mm,0]}
 ]};
}
export async function buildKizBoxLabel(code:string,title:string){
 configurePdfMake();const pdf=await pdfMake.createPdf(kizBoxLabelDefinition(code,title)).getBuffer();const parser=new PDFParse({data:pdf});try{const result=await parser.getScreenshot({desiredWidth:696,imageDataUrl:false,imageBuffer:true});if(result.pages.length!==1)throw new Error('Этикетка не поместилась.');return Buffer.from(result.pages[0].data).toString('base64');}finally{await parser.destroy();}
}
