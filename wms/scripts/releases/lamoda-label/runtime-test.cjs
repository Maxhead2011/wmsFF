// TEST: execute the exact release modules with isolated mocks; never connect to a database/printer.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');const root=process.argv[2];
require(require.resolve('reflect-metadata',{paths:[root]}));
const {validateLamodaLabel,buildLamodaLabelPdf,lamodaLabelImage}=require(path.join(root,'modules/print/lamoda-label'));
const {readLamodaLabel}=require(path.join(root,'modules/print/lamoda-label.service'));
const {freezeLamodaBatchLabels}=require(path.join(root,'modules/print/lamoda-batch-label'));
const {LamodaLabelController}=require(path.join(root,'modules/print/lamoda-label.controller'));
const {FboTwoStageService}=require(path.join(root,'modules/tsd/fbo-two-stage.service'));
const {PDFDocument}=require(require.resolve('pdf-lib',{paths:[root]}));
const r=Object.values(JSON.parse(fs.readFileSync(process.argv[3])).records)[0];
(async()=>{
 process.env.WMS_LAMODA_ENABLED='true';process.env.WMS_LAMODA_FBO_RELABEL_ENABLED='true';process.env.WMS_FBO_TWO_STAGE_ENABLED='true';
 const snapshot=freezeLamodaBatchLabels([{...r,skuId:'sku',model:'Model'}],[{...r,skuId:'sku',manufacturedAt:'25.11.2026'}],true)[0];
 assert.equal(snapshot.fullLabel.manufacturedAt,'25.11.2026');assert.equal(r.manufacturedAt,'01.10.2026');
 const pdf=await buildLamodaLabelPdf(snapshot.fullLabel),doc=await PDFDocument.load(pdf),png=await lamodaLabelImage(pdf);assert.equal(doc.getPageCount(),1);assert(Math.abs(doc.getPage(0).getWidth()-58*72/25.4)<.01);assert(png.length<20000);
 const jobs=[],unit={id:'unit',requestId:'req',skuId:'sku',state:'PICKED',wholeBox:false,lamodaRelabelPrintId:null};
 const binding={planId:'plan',relabelLabels:[snapshot]};
 const tx={$queryRaw:async()=>[],lamodaFboAssembly:{findUniqueOrThrow:async()=>binding},fboAssemblyUnit:{findFirst:async()=>unit,update:async({data})=>Object.assign(unit,data)},fbsPrintStation:{findFirst:async()=>({id:'station'})},fbsPrintJob:{findUnique:async({where})=>jobs.find(j=>j.historyId===where.historyId)||null,create:async({data})=>{const j={...data,status:'QUEUED',errorMessage:null};jobs.push(j);return j;}},auditLog:{create:async()=>{}}};
 const svc=Object.create(FboTwoStageService.prototype);svc.prisma={...tx,$transaction:async f=>f(tx)};svc.load=async()=>({id:'req',clientId:'c',status:'IN_WORK',client:{name:'Client',relabelingEnabled:true},items:[{skuId:'sku',sku:{id:'sku',name:'Suit'}}]});svc.requireFbo=()=>{};svc.relabelStations=async()=>[{id:'station'}];
 const body={unitId:'unit',stationId:'station',printId:'12345678-1234-4123-8123-123456789012'};
 const first=await svc.printLamodaRelabel('req',body,{id:'u'});const repeat=await svc.printLamodaRelabel('req',{...body,printId:'22345678-1234-4123-8123-123456789012'},{id:'u'});
 assert.deepEqual(first,repeat);assert.equal(jobs.length,1);assert.equal(jobs[0].stickerCode,r.barcode);assert.equal(jobs[0].source,'TSD_RELABEL');assert.equal(jobs[0].stickerMime,'image/png');
 const db={sku:{findFirst:async()=>({id:'sku',clientId:'c'})},systemSetting:{findUnique:async()=>({value:{clientId:'c',enabled:true,records:{[r.barcode]:r}}})},lamodaProduct:{findMany:async()=>[{barcode:r.barcode,remoteSku:r.article}]}};
 const controller=new LamodaLabelController(db,{resolveClientFilter:()=> 'c',requireClientAccess:(u,c,mode)=>{assert.equal(c,'c');assert.equal(mode,'read')}});
 const preview=await controller.preview('sku',undefined,{id:'u'});assert.equal(preview.barcode,r.barcode);assert.equal(preview.widthMm,58);assert(preview.pdfBase64);
 process.env.WMS_LAMODA_ENABLED='false';assert.equal(await readLamodaLabel({},'c','sku'),null);
 console.log('PASS runtime: complete PDF/PNG, batch snapshot, real relabel handler repeat deduplication, scoped preview, sold flag disabled.');
})().catch(e=>{console.error(e);process.exitCode=1});
