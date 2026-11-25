// FIX: apply only this delta to a fresh runtime snapshot; never replace the whole service.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!fs.existsSync(path.join(root,'app.module.js')))throw Error('Pass an extracted current API runtime');
const moduleDir=path.join(root,'modules/marketplace-connections');
if(fs.existsSync(path.join(moduleDir,'ozon-print-preparation.js')))throw Error('Use a fresh runtime snapshot; candidate already contains print preparation');
const pending=new Map();
function edit(name,changes){const file=path.join(moduleDir,name);let text=fs.readFileSync(file,'utf8');for(const [before,after] of changes){if(text.split(before).length!==2)throw Error(name+': ambiguous/missing '+before.slice(0,80));text=text.replace(before,after);}pending.set(file,text);}
function hashes(dir,prefix=''){const rows={};for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='node_modules')continue;const rel=prefix+e.name,p=path.join(dir,e.name);if(e.isDirectory())Object.assign(rows,hashes(p,rel+'/'));else if(e.isFile())rows[rel]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}return rows;}
const before=hashes(root);
const source=path.resolve(__dirname,'../../../apps/api/src/modules/marketplace-connections/ozon-print-preparation.ts');
const compiled=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
pending.set(path.join(moduleDir,'ozon-print-preparation.js'),compiled);
edit('marketplace-connections.service.js',[
 ['"use strict";','"use strict";\nconst ozonPrint=require("./ozon-print-preparation");'],
 ['    async assembleFbsOrders(dto, user) {',`    async prepareOzonLabels(dto, user) {
        const clientId=dto.clientId.trim();
        this.clientScopes.requireClientAccess(user,clientId,'write');
        const result=await ozonPrint.prepareOzonPrint(this.prisma,clientId,dto.orders,user,marketplaceJson);
        this.fbsOrdersCache.delete(clientId);this.fbsTsdRequestFallbackCache.delete(clientId);
        return result;
    }
    async assembleFbsOrders(dto, user) {`],
 ['!isFbsTsdSupplierStatusEligible(linkMarketplace, link.lastSupplierStatus)',"!isFbsTsdSupplierStatusEligible(linkMarketplace, link.lastSupplierStatus) && !(linkMarketplace==='OZON' && link.lastSupplierStatus==='awaiting_deliver' && await ozonPrint.hasOzonPrintPreparation(this.prisma,link.request.client.id,link.connectionId,link.orderId,link.requestId))"],
 ['                const candidates = response.orders','                await ozonPrint.decorateOzonPrintPrepared(this.prisma,clientId,response.orders);\n                const candidates = response.orders'],
 ['\n        const candidates = response.orders','\n        await ozonPrint.decorateOzonPrintPrepared(this.prisma,currentTask.clientId,response.orders);\n        const candidates = response.orders'],
 ['        let reservationByOrder = new Map();','        await ozonPrint.decorateOzonPrintPrepared(this.prisma,clientId,ordersWithRequests);\n        let reservationByOrder = new Map();'],
 ['isFbsTsdSupplierStatusEligible(order.marketplace, order.supplierStatus)',"(isFbsTsdSupplierStatusEligible(order.marketplace, order.supplierStatus) || (order.marketplace==='OZON' && order.supplierStatus==='awaiting_deliver' && order.ozonPrintPrepared===true))"],
]);
for(const [name,identity] of [['fbs-fabric-queue.js','clientId,order.connectionId,order.id,posting,order.request?.id'],['ozon-fbs-pick-workflow.js','task.clientId,task.connectionId,task.orderId,posting,task.requestId']])edit(name,[
 ['"use strict";','"use strict";\nconst ozonPrint=require("./ozon-print-preparation");'],
 ["posting.status !== 'awaiting_packaging'",`(posting.status !== 'awaiting_packaging' && !await ozonPrint.isOzonPrintPrepared(service.prisma,${identity}))`],
]);
const controller=path.join(moduleDir,'marketplace-connections.controller.js');
let text=fs.readFileSync(controller,'utf8');
const decorator=text.match(/__decorate\(\[\s*\(0, common_1.Post\)\('fbs\/orders\/assemble'\),[\s\S]*?"assembleFbsOrders", null\);/);
if(!decorator)throw Error('Missing assembly controller metadata');
edit('marketplace-connections.controller.js',[
 ['    assembleFbsOrders(dto, user) {','    prepareOzonLabels(dto,user) { return this.connections.prepareOzonLabels(dto,user); }\n    assembleFbsOrders(dto, user) {'],
 [decorator[0],decorator[0]+'\n'+decorator[0].replace("'fbs/orders/assemble'","'fbs/orders/prepare-labels'").replace('"assembleFbsOrders", null','"prepareOzonLabels", null')],
]);
const registry=fs.readFileSync(path.join(root,'modules/administration/administration-internal-api.service.js'),'utf8');
const group=registry.match(/id: 'marketplace-connections',[\s\S]*?routeCount:\s*(\d+),/);
if(!group)throw Error('Missing marketplace API registry group');
edit('../administration/administration-internal-api.service.js',[
 [group[0],group[0].replace(/routeCount:\s*\d+,/,'routeCount: '+(Number(group[1])+1)+',')],
]);
for(const [file,text] of pending)fs.writeFileSync(file,text);
const after=hashes(root),changed=Object.keys(after).filter(k=>before[k]!==after[k]);
const allowed=['ozon-print-preparation.js','marketplace-connections.service.js','marketplace-connections.controller.js','fbs-fabric-queue.js','ozon-fbs-pick-workflow.js'].map(k=>'modules/marketplace-connections/'+k).concat('modules/administration/administration-internal-api.service.js');
if(changed.length!==allowed.length||changed.some(k=>!allowed.includes(k))||Object.keys(before).some(k=>!after[k]))throw Error('Unexpected candidate delta');
console.log(JSON.stringify({changed,unchanged:Object.keys(before).length-5,before,after}));
