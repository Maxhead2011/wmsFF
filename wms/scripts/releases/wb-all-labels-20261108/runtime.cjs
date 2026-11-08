// TEST: exercise compiled production methods with synthetic readers, network disabled.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=process.argv[2],dir=root+'/modules/marketplace-connections/';
const {PDFDocument}=require('pdf-lib'),{BadRequestException,ForbiddenException}=require('@nestjs/common');
const {wbAllLabels}=require(dir+'wb-all-labels');
async function file(n){const pdf=await PDFDocument.create();pdf.addPage([n,100]);return{buffer:Buffer.from(await pdf.save())}}
async function main(){let passed=0;const order={id:'1',connectionId:'a',marketplace:'WILDBERRIES',supplyId:'s'};
 const {MarketplaceConnectionsService:S}=require(dir+'marketplace-connections.service');
 const {MarketplaceConnectionsController:C}=require(dir+'marketplace-connections.controller');
 assert.equal(Reflect.getMetadata('path',C.prototype.getFbsAllLabels),'fbs/orders/all-labels');passed++;
 const calls=[];const service={clientScopes:{requireClientAccess:(u,id,mode)=>{assert.equal(id,'client');assert.equal(mode,'read');calls.push('scope')}},resolveSelectedFbsOrders:async()=>{calls.push('resolve');return{orders:[order]}},getFbsSupplyStickersPdf:async()=>file(11),getFbsCargoPlaceStickersPdf:async()=>file(22),getFbsOrderStickersPdf:async()=>file(33)};
 const result=await S.prototype.getFbsAllLabels.call(service,{clientId:' client ',orders:[order]},{});
 assert.deepEqual(calls,['scope','resolve']);const pdf=await PDFDocument.load(Buffer.from(result.fileBase64,'base64'));assert.deepEqual(pdf.getPages().map(p=>p.getWidth()),[11,22,33]);passed++;
 service.getFbsSupplyStickersPdf=async()=>{throw new BadRequestException('Передача не выполнена')};
 const partial=await S.prototype.getFbsAllLabels.call(service,{clientId:'client',orders:[order]},{});assert.equal(partial.pageCount,2);assert.match(partial.warnings[0],/СЦ/);passed++;
 service.clientScopes.requireClientAccess=()=>{throw new ForbiddenException()};calls.length=0;
 await assert.rejects(S.prototype.getFbsAllLabels.call(service,{clientId:'client',orders:[order]},{}),ForbiddenException);assert.equal(calls.length,0);passed++;
 const read={sc:async()=>file(1),pvz:async()=>file(2),pairs:async()=>{throw new BadRequestException('Нет стикера')}};
 const rest=await wbAllLabels([order],read);assert.equal(rest.pageCount,2);assert.match(rest.warnings[0],/товара/);passed++;
 const output=await C.prototype.getFbsAllLabels.call({connections:{getFbsAllLabels:async(dto,user)=>({dto,user})}},{clientId:'client'},'scoped-user');assert.equal(output.user,'scoped-user');passed++;
 fs.writeFileSync(process.argv[3],JSON.stringify({passed,syntheticOnly:true,networkDisabled:true}));console.log({passed});
}main().catch(e=>{console.error(e);process.exitCode=1});
