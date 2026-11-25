// TEST: render every supplied record with the actual candidate modules.
const fs=require('fs'),path=require('path');const dir=path.resolve(process.argv[2]);
const {buildLamodaLabelPdf,lamodaLabelImage}=require(path.join(dir,'api/modules/print/lamoda-label.js'));
const {PDFDocument}=require('pdf-lib');
(async()=>{const catalog=JSON.parse(fs.readFileSync(path.join(dir,'catalog.json'))),all=await PDFDocument.create(),proof=[];fs.mkdirSync(path.join(dir,'rendered'),{recursive:true});
for(const r of Object.values(catalog.records)){const pdf=await buildLamodaLabelPdf(r),png=await lamodaLabelImage(pdf);fs.writeFileSync(path.join(dir,'rendered',r.barcode+'.pdf'),pdf);fs.writeFileSync(path.join(dir,'rendered',r.barcode+'.png'),Buffer.from(png,'base64'));const [p]=await all.copyPages(await PDFDocument.load(pdf),[0]);all.addPage(p);proof.push({barcode:r.barcode,pngBase64Bytes:png.length});}
fs.writeFileSync(path.join(dir,'Lamoda-58x40-136.pdf'),await all.save());fs.writeFileSync(path.join(dir,'render-proof.json'),JSON.stringify(proof,null,2));console.log({labels:proof.length,maxPngBytes:Math.max(...proof.map(p=>p.pngBase64Bytes))});})();
