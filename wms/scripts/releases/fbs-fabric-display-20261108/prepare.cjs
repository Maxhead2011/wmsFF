// FIX: exact current-runtime overlay; no unrelated method or asset replacement.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const patches=[];
function once(s,old,next){assert.equal(s.split(old).length,2,'Anchor must be unique: '+old.slice(0,70));patches.push([old,next]);return s.replace(old,next)}
const moduleDir='modules/marketplace-connections/';
const file=moduleDir+'marketplace-connections.service.js';let s=read(root+'/api-base/'+file),base=s;
s=once(s,'const reservableOrders = relevantOrders.filter((order) => {',
 'const fabricOrders = await fabricReservationOrders(this.prisma, clientId, relevantOrders, taskByKey);\n        const reservableOrders = relevantOrders.filter((order) => {\n            if (fabricOrders.has(selectionKey(order.connectionId, order.id))) return false;');
s=once(s,'const routeResolutionByKey = new Map();\n            for (const order of relevantOrders) {',
 'const routeResolutionByKey = new Map();\n        for (const order of relevantOrders) {\n            if (fabricOrders.has(selectionKey(order.connectionId, order.id))) continue;');
s=once(s,'reservedBoxCode: true,\n                    reservedAt: true,\n                    boxId: true,\n                    boxCode: true,\n                    errorMessage: true,',
 'reservedBoxCode: true,\n                    reservedAt: true,\n                    boxId: true,\n                    boxCode: true,\n                    errorMessage: true,\n                    barcode: true, sourceBarcode: true, kiz: true, relabelConfirmedAt: true, completedAt: true, marketplaceSubmittedAt: true,');
s=once(s,'return result;\n    }\n    async loadFbsDeliveryPlan(clientId) {',
 `const freshTasks = new Map(tasks.map(task => [selectionKey(task.connectionId, task.orderId), task]));
        const displayFabricOrders = await fabricReservationOrders(this.prisma, clientId, relevantOrders, freshTasks);
        for (const key of displayFabricOrders) if (untouchedFabricReservation(freshTasks.get(key))) {
            result.set(key, { status: 'FABRIC_ON_DEMAND', withoutBox: true, boxCode: null, palletCode: null, warehouseId: null, reservedAt: null, problem: null });
        }
        return result;
    }
    async loadFbsDeliveryPlan(clientId) {`);
let restored=s;for(const [old,next] of [...patches].reverse())restored=restored.replace(next,old);assert.equal(restored,base);
s='const { fabricReservationOrders, untouchedFabricReservation } = require("./fbs-fabric-reservation");\n'+s;
write(root+'/api-payload/'+file,s);
write(root+'/api-payload/'+moduleDir+'fbs-fabric-reservation.js',compile(read('apps/api/src/'+moduleDir+'fbs-fabric-reservation.ts')));
write(root+'/api-changes.json',JSON.stringify([file,moduleDir+'fbs-fabric-reservation.js']));
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});
const old='/assets/client-stores-workspace-fbs-20261028.js',next='/assets/fabric-reservation-fbs-20261108.js';
let web=read(root+'/web-base'+old);const originalWeb=web;
const anchor='(oe=s.reservation)!=null&&oe.withoutBox&&s.reservation.status==="RESERVED"?';
const addition='s.reservation?.status==="FABRIC_ON_DEMAND"?e.jsxs("div",{className:"fbs-pallet-reservation",children:[e.jsx("strong",{children:"Нарезка по факту"}),e.jsx("small",{children:"Из рулона. Готовый отрез и короб на остатках не требуются."}),e.jsx("small",{children:"Метры проверяются при сборке; это не подтверждение резерва ткани."})]}):';
assert.equal(web.split(anchor).length,2);web=web.replace(anchor,addition+anchor);assert.equal(web.replace(addition,''),originalWeb);
for(const [n,text] of [['api.js',s],['web.js',web]])assert.equal(ts.createSourceFile(n,text,99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);
write(root+'/web-payload'+next,web);
let html=read(root+'/web-base/index.html');const match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);let count=0;
for(const key of Object.keys(map.imports))if(map.imports[key]===old){map.imports[key]=next;count++;}assert(count);map.imports[old]=next;
html=html.replace(match[1],()=>JSON.stringify(map));write(root+'/web-payload/index.html',html);
write(root+'/web-changes.json',JSON.stringify(['index.html',next.slice(1)]));
write(root+'/overlay-proof.json',JSON.stringify({apiHunks:4,webExpression:1,existingBytesPreserved:true}));
console.log('Prepared API2/web2; original bytes outside reviewed additions preserved');
