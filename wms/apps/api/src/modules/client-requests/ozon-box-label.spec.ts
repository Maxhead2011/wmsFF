import {it,expect,vi} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {PDFParse} from 'pdf-parse';
import {annotateOzonLabels} from './ozon-print-labels';
// TEST: Ozon can return pages in the reverse of cargo creation order.
it('prints the actual box code on each PDF page',async()=>{
 vi.stubEnv('WMS_OZON_BOX_LABEL_ENABLED','true');
 try {
 const pdf=await PDFDocument.create();
 for(const id of ['2222222222222222','1111111111111111']) pdf.addPage([340,212]).drawText(id,{x:10,y:90,size:12});
 const buffer=await annotateOzonLabels(Buffer.from(await pdf.save()),[{key:'a',cargoId:'1111111111111111'},{key:'b',cargoId:'2222222222222222'}],[{id:'a',boxCode:'BOX_001'},{id:'b',boxCode:'BOX_007'}]);
 const parser=new PDFParse({data:new Uint8Array(buffer)});
 try {const {pages}=await parser.getText();expect(pages[0].text).toContain('BOX_007');expect(pages[1].text).toContain('BOX_001');} finally {await parser.destroy();}
 }finally{vi.unstubAllEnvs();}
});
