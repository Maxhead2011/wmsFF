// FIX: replace only independently matched methods in the deployed service.
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const r=path.resolve(process.argv[2]),file='modules/marketplace-connections/marketplace-connections.service.js',src='apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:1,target:9,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
const old=compile(cp.execFileSync('git',['show','HEAD:wms/'+src],{encoding:'utf8',maxBuffer:10e6})),next=compile(fs.readFileSync(src,'utf8'));
function methods(s){const ast=ts.createSourceFile('service.js',s,99,true),m=new Map();function walk(n){if(ts.isMethodDeclaration(n)&&n.name)m.set(n.name.getText(ast),{text:n.getText(ast),start:n.getStart(ast),end:n.end});ts.forEachChild(n,walk)}walk(ast);return m;}
const tokens=s=>{const scanner=ts.createScanner(99,true,ts.LanguageVariant.Standard,s.replace(/\r\n/g,"\n")),a=[];while(scanner.scan()!==ts.SyntaxKind.EndOfFileToken)a.push(scanner.getTokenText());return JSON.stringify(a)};
let base=fs.readFileSync(r+'/api-base/'+file,'utf8'),live=methods(base),before=methods(old),after=methods(next),edits=[];
for(const [name,n]of after){const b=before.get(name);if(b&&tokens(b.text)!==tokens(n.text)){const actual=live.get(name);assert(actual,name);
if(name==='ensureFbsProcessingCharges'){
 let replacement=actual.text;
 function once(a,b){assert.equal(replacement.split(a).length,2,'anchor '+a);replacement=replacement.replace(a,b);}
 once('async ensureFbsProcessingCharges(clientId, orders)', 'async ensureFbsProcessingCharges(clientId, orders, wbObservedOrders = orders)');
 const start=n.text.indexOf('const observedWb ='),end=n.text.indexOf('for (let skip',start);assert(start>0&&end>start);
 once('orders = orders.filter(order => order.marketplace !== client_1.MarketplaceType.WILDBERRIES);',n.text.slice(start,end));
 once('orders.push(...facts.map(fact => {','const localOrders = facts.map(fact => {');
 const loopStart=n.text.indexOf('for (const order of localOrders)'),loopEnd=n.text.indexOf('if (facts.length',loopStart);
 assert(loopStart>0&&loopEnd>loopStart);
 once('}));\n                if (facts.length','});\n                '+n.text.slice(loopStart,loopEnd)+'if (facts.length');
 edits.push({...actual,name,replacement});
}else if(name==='loadFbsOrdersUncached'){
 let replacement=actual.text;const a="if ((0, wb_order_stock_lifecycle_1.wbOrderStockLifecycleEnabled)()) {\n            ordersWithStockSources = await this.applyLocalWbShipments";
 assert.equal(replacement.split(a).length,2);replacement=replacement.replace(a,'const billingWbObservations = ordersWithStockSources;\n        '+a);
 const x="this.ensureFbsProcessingCharges(clientId, ordersWithReservations.filter((order) => order.category === 'shipped'))";
 assert.equal(replacement.split(x).length,2);replacement=replacement.replace(x,"this.ensureFbsProcessingCharges(clientId, (0, wb_order_stock_lifecycle_1.wbOrderStockLifecycleEnabled)() ? ordersWithReservations : ordersWithReservations.filter((order) => order.category === 'shipped'), ...((0, wb_order_stock_lifecycle_1.wbOrderStockLifecycleEnabled)() ? [billingWbObservations] : []))");
 edits.push({...actual,name,replacement});
}else{assert.equal(tokens(actual.text),tokens(b.text),'runtime drift '+name);edits.push({...actual,name,replacement:n.text});}}}
assert.equal(edits.length,3);let result=base;for(const e of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,e.start)+e.replacement+result.slice(e.end);
let inverse=result;for(const e of edits)inverse=inverse.replace(e.replacement,e.text);assert.equal(inverse,base);
fs.mkdirSync(r+'/api-payload/'+path.dirname(file),{recursive:true});fs.writeFileSync(r+'/api-payload/'+file,result);fs.writeFileSync(r+'/api-changes.json',JSON.stringify([file]));console.log('PASS inverse: ',edits.map(e=>e.name));
