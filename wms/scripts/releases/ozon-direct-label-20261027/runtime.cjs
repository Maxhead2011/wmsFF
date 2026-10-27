// TEST: compiled candidate service with external calls stubbed, no database writes.
const assert=require('assert/strict');const root='/candidate/modules/marketplace-connections/';
const {MarketplaceConnectionsService:S}=require(root+'marketplace-connections.service');
const {PDFDocument}=require('pdf-lib');
(async()=>{process.env.WMS_OZON_DIRECT_LABEL_ENABLED='true';const s=Object.create(S.prototype);let calls=[];
s.clientScopes={requireClientAccess(){}};s.prisma={clientMarketplaceConnection:{findMany:async()=>[{id:'c',marketplace:'OZON',sellerId:'test',apiKey:'test'}]}};
s.resolveSelectedFbsOrders=async()=>{throw Error('Unexpected full reload')};const doc=await PDFDocument.create();doc.addPage([100,100]);const bytes=await doc.save();
global.fetch=async(url,init)=>{calls.push(url);return url.endsWith('/get')?new Response(JSON.stringify({result:{posting_number:'order',status:'awaiting_deliver'}}),{headers:{'Content-Type':'application/json'}}):new Response(bytes,{headers:{'Content-Type':'application/pdf'}})};
const result=await s.getFbsOrderStickersPdf({clientId:'client',orders:[{connectionId:'c',id:'order'}]},{});assert.equal(result.count,1);assert.equal(result.buffer.subarray(0,4).toString(),'%PDF');assert.equal(calls.length,2);console.log('PASS: actual runtime downloads only selected posting; valid merged PDF');})().catch(e=>{console.error(e);process.exitCode=1});
