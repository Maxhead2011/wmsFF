// TEST: invoke the real compiled download method, with read-only synthetic adapters.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),Module=require('module');
const root=path.resolve(process.argv[2]),which=process.argv[3]||'api-candidate',candidate=path.join(root,which);
process.env.NODE_PATH=[path.resolve('apps/api/node_modules'),path.resolve('node_modules'),process.env.NODE_PATH].filter(Boolean).join(path.delimiter);Module._initPaths();
const local=Module.createRequire(path.resolve('apps/api/package.json')),load=Module._load;
Module._load=function(name,parent,main){if(parent?.filename.startsWith(candidate)&&!name.startsWith('.')&&!path.isAbsolute(name))return local(name);return load.apply(this,arguments)};
const {PDFDocument}=local('pdf-lib'),bwip=local('bwip-js');
const {MarketplaceConnectionsService}=require(candidate+'/modules/marketplace-connections/marketplace-connections.service');
const skus=Array.from({length:4},(_,i)=>({id:'s'+i,name:'Ткань атлас сатин '+(i===3?'синий':'красный')+' 30 метров',internalSku:(i===3?'blue':'red')+'_30-0',barcodes:[{value:'20000000000'+(10+i)}]}));
const orders=skus.map((s,i)=>({id:String(100+i),connectionId:'c',marketplace:'WILDBERRIES',supplierStatus:'confirm',category:'active',product:s,barcodes:s.barcodes.map(b=>b.value),itemCount:1}));
const db={systemSetting:{findUnique:async()=>({value:{enabled:true}})},clientMarketplaceConnection:{findMany:async()=>[{id:'c',marketplace:'WILDBERRIES',apiKey:'test-only'}]},sku:{findMany:async()=>skus}};
const service=Object.create(MarketplaceConnectionsService.prototype);
service.prisma=db;service.clientScopes={requireClientAccess:()=>{}};service.resolveSelectedFbsOrders=async()=>({orders});
service.loadSelectedConnections=async()=>[{id:'c',marketplace:'WILDBERRIES',apiKey:'test-only'}];
process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='true';process.env.WMS_FBS_FABRIC_CUT_ENABLED='false';process.env.WMS_OZON_DIRECT_LABEL_ENABLED='false';
let calls=0;
global.fetch=async(url,init)=>{assert(String(url).includes('/orders/stickers?'));calls++;
 const stickers=await Promise.all(JSON.parse(init.body).orders.map(async id=>({orderId:id,barcode:'WB'+id,file:(await bwip.toBuffer({bcid:'qrcode',text:'WB'+id,scale:4})).toString('base64')})));
 return new Response(JSON.stringify({stickers}),{status:200,headers:{'Content-Type':'application/json'}});
};
(async()=>{
 const dto={clientId:'client',orders:orders.map(o=>({id:o.id,connectionId:o.connectionId}))};
 const file=await service.getFbsOrderStickersPdf(dto,{}),pdf=await PDFDocument.load(file.buffer);
 const expected=which==='api-base'?4:8;assert.equal(pdf.getPageCount(),expected);assert.equal(file.count,4);assert.equal(calls,1);
 fs.writeFileSync(root+'/'+which+'-four-orders.pdf',file.buffer);
 if(which!=='api-base'){
   process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='false';assert.equal((await PDFDocument.load((await service.getFbsOrderStickersPdf(dto,{})).buffer)).getPageCount(),4);
   process.env.WMS_FBS_FABRIC_CUT_ENABLED='true';assert.equal((await PDFDocument.load((await service.getFbsOrderStickersPdf(dto,{})).buffer)).getPageCount(),8);
   service.clientScopes.requireClientAccess=()=>{throw Error('denied')};const before=calls;
   await assert.rejects(()=>service.getFbsOrderStickersPdf(dto,{}),/denied/);assert.equal(calls,before);
 }
 const proof={passed:which==='api-base'?1:4,pages:pdf.getPageCount(),orders:4,marketplaceMutations:0};
 fs.writeFileSync(root+'/'+which+'-proof.json',JSON.stringify(proof));console.log(proof);process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
