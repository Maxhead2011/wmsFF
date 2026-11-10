// TEST: actual compiled service method and PDF composer; network/business writes forbidden.
const fs=require('fs'),assert=require('node:assert/strict'),root=process.argv[2],out=process.argv[3];
const req=require('module').createRequire(root+'/main.js'),{PDFDocument}=req('pdf-lib');req('reflect-metadata');
const {MarketplaceConnectionsService:S}=require(root+'/modules/marketplace-connections/marketplace-connections.service');
global.fetch=()=>{throw Error('Network forbidden')};
(async()=>{const pdf=await PDFDocument.create();pdf.addPage([164.4,113.4]);pdf.addPage([164.4,113.4]);const buffer=Buffer.from(await pdf.save());let pairs=0,sc=0,pvz=0;
 const orders=[{id:'posting',connectionId:'c',marketplace:'OZON',supplyId:null}];
 const service={clientScopes:{requireClientAccess:(_u,id)=>{if(id!=='client')throw Error('Forbidden')}},resolveFbsLabelOrders:async()=>({orders}),getFbsSupplyStickersPdf:async()=>{sc++;throw Error('Wrong marketplace')},getFbsCargoPlaceStickersPdf:async()=>{pvz++;throw Error('Wrong marketplace')},getFbsOrderStickersPdf:async()=>{pairs++;return{buffer}}};
 const call=()=>S.prototype.getFbsAllLabels.call(service,{clientId:'client',orders},{});
 delete process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED;await assert.rejects(call(),/Wildberries/);
 process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='true';const result=await call();assert.equal(result.pageCount,2);assert.equal(result.fileName,'FBS_OZON_all_labels.pdf');assert.deepEqual(result.warnings,[]);assert.equal(sc+pvz,0);assert.equal(pairs,1);
 const decoded=await PDFDocument.load(Buffer.from(result.fileBase64,'base64'));assert.equal(decoded.getPageCount(),2);
 await assert.rejects(S.prototype.getFbsAllLabels.call(service,{clientId:'foreign',orders},{}),/Forbidden/);assert.equal(pairs,1);
 fs.writeFileSync(out+'/runtime-api-proof.json',JSON.stringify({passed:5,actualService:true,syntheticOnly:true,noNetwork:true}));console.log('Runtime service/PDF5 passed');
})().catch(e=>{console.error(e);process.exitCode=1});
