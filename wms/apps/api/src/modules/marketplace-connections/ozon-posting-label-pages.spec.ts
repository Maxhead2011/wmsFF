import {expect,it} from 'vitest';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {ozonPostingLabelPages} from './ozon-posting-label-pages';
async function pdf(texts:string[]){const d=await PDFDocument.create(),f=await d.embedFont(StandardFonts.Helvetica);for(const t of texts)d.addPage([164,113]).drawText(t,{x:4,y:60,font:f,size:8});return Buffer.from(await d.save());}
// TEST: Ozon itself mixes product labels into the official PDF; retain only proven shipment pages.
it('keeps legacy posting and scanit pages while removing OZN product labels',async()=>{
 const result=await ozonPostingLabelPages(await pdf(['6907 5936 -0057-2','OZN6043909341 red_50','OZN6043909341 red_50','ii5020377 7528','OZN6043909341 red_50']),[{posting_number:'69075936-0057-2'},{posting_number:'0214691742-0254-3',scanit:'ii50203777528'}]);
 expect((await PDFDocument.load(result)).getPageCount()).toBe(2);
});
it('rejects a PDF missing a selected shipment instead of guessing first pages',async()=>{await expect(ozonPostingLabelPages(await pdf(['OZN6043909341']),[{posting_number:'missing'}])).rejects.toThrow('не удалось');});
it('recognizes an official barcode and keeps the original page dimensions',async()=>{const result=await ozonPostingLabelPages(await pdf(['official-barcode','OZN6043909341']),[{posting_number:'posting',barcodes:{lower_barcode:'official-barcode'}}]);const d=await PDFDocument.load(result);expect(d.getPageCount()).toBe(1);expect(d.getPage(0).getWidth()).toBe(164);});
