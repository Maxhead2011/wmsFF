// FIX: preserve all unrelated deployed modules and runtime-only methods.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const r=path.resolve(process.argv[2]),w=path.resolve(__dirname,'../../..');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
function save(p,s){fs.mkdirSync(path.dirname(r+'/'+p),{recursive:true});fs.writeFileSync(r+'/'+p,s);}
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
function compile(n){return ts.transpileModule(read(w+'/apps/api/src/'+n+'.ts'),{compilerOptions:{target:99,module:1,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;}
function classNode(a){let result;function walk(n){if(ts.isClassExpression(n)||ts.isClassDeclaration(n))result=n;else ts.forEachChild(n,walk)}walk(a);assert(result);return result;}
function methods(base,compiled,names){
 const a=ts.createSourceFile('base.js',base,99,true),b=ts.createSourceFile('new.js',compiled,99,true),ca=classNode(a),cb=classNode(b),edits=[];let added='';
 for(const name of names){const newer=cb.members.find(n=>n.name?.getText(b)===name);assert(newer,name);const old=ca.members.find(n=>n.name?.getText(a)===name);if(old)edits.push([old.getStart(a),old.end,newer.getText(b)]);else added+='\n'+newer.getText(b)+'\n';}
 if(added)edits.push([ca.end-1,ca.end-1,added]);for(const [start,end,value]of edits.sort((a,b)=>b[0]-a[0]))base=base.slice(0,start)+value+base.slice(end);return base;
}
save('api-payload/modules/warehouse/cargo-pickup-policy.js',compile('modules/warehouse/cargo-pickup-policy'));
let n='modules/warehouse/warehouse.service.js',s=read(r+'/api-live/'+n),c=compile(n.slice(0,-3));
s=methods(s,c,['createGoodsArrival','deleteGoodsArrival','deleteGoodsArrivalLocked','activeCargoInvoice','billCargoPickups','billCargoPickupsLocked','updateCargoPickup','goodsArrivalSummary']);
s='const cargo_pickup_policy_1=require("./cargo-pickup-policy");const billing_mutation_1=require("../billing/billing-mutation");\n'+s;
s=once(s,"billingInvoiceId: text(payload.billingInvoiceId) || null,","billingInvoiceId: text(payload.billingInvoiceId) || null,\nourDelivery:payload.ourDelivery===true,deliveryCostRub:payload.ourDelivery===true?Number(payload.deliveryCostRub)||0:null,cargoInvoiceId:text(payload.cargoInvoiceId)||null,");save('api-payload/'+n,s);
n='modules/warehouse/warehouse.controller.js';s=read(r+'/api-live/'+n);c=compile(n.slice(0,-3));s=methods(s,c,['billCargoPickups','updateCargoPickup']);
const ast=ts.createSourceFile('c.js',c,99,true);for(const node of ast.statements){let text=node.getText(ast);if(text.startsWith('__decorate(')&&['"billCargoPickups"','"updateCargoPickup"'].some(name=>text.includes(name))){text=text.replace(/__metadata\("design:paramtypes", \[[^\n]+\]\)/,text.includes('"updateCargoPickup"')?'__metadata("design:paramtypes", [String,Object,Object])':'__metadata("design:paramtypes", [Object,Object])');s+='\n'+text;}}
save('api-payload/'+n,s);
n='modules/billing/billing.service.js';s=read(r+'/api-live/'+n);
const anchor="if (dto.status === client_1.BillingInvoiceStatus.DRAFT && paidRub > 0) {\n            throw new common_1.BadRequestException('Нельзя вернуть в черновик счет с оплатами.');\n        }\n        const updated = await this.prisma.$transaction(async (tx) => {";
s=once(s,anchor,anchor+'\nif(process.env.WMS_CARGO_PICKUP_ENABLED==="true"&&dto.status===client_1.BillingInvoiceStatus.CANCELLED)await tx.billingCharge.updateMany({where:{service:{code:"CARGO_PICKUP"},invoiceItems:{some:{invoiceId}}},data:{status:client_1.BillingChargeStatus.CANCELLED}});');
s=once(s,"else purposeLabel = 'Услуги';","else if(process.env.WMS_CARGO_PICKUP_ENABLED==='true' && charges.length && charges.every(c=>c.service?.code==='CARGO_PICKUP'))purposeLabel='Забор товара с карго';\n            else purposeLabel = 'Услуги';");save('api-payload/'+n,s);
n='modules/administration/administration-internal-api.service.js';s=read(r+'/api-live/'+n);s=once(s,'routeCount: 42,','routeCount: 44,');save('api-payload/'+n,s);

// Replace only the deployed goods-arrival component; keep React, remembered client and API helpers.
let html=read(r+'/web-base/index.html'),old=path.basename(read(r+'/web-entry.txt').trim()),next='cargo-pickup-20261031.js';s=read(r+'/web-base/assets/'+old);
const webAst=ts.createSourceFile('web.js',s,99,true),at=s.indexOf('className:"goods-arrivals"');let target;
function walk(n){if(ts.isFunctionDeclaration(n)&&n.pos<at&&n.end>at)target=n;ts.forEachChild(n,walk)}walk(webAst);assert.equal(target.name.text,'W8');
const source=read(w+'/apps/web/src/components/warehouse/GoodsArrivalPanel.tsx'),component=ts.createSourceFile('x.tsx',source,99,true,ts.ScriptKind.TSX);
const body=component.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(component)).join('\n');
const preamble=`const useEffect=x.useEffect,useState=x.useState,useRememberedClientId=Lt,validRememberedClientId=Pr,fetchClients=Rt,fetchGoodsArrivals=FP,fetchGoodsArrivalEstimate=Ew,createGoodsArrival=UP,deleteGoodsArrival=qP,billGoodsArrivals=WP,FilePlus2=Af,ReceiptText=()=>null,RefreshCw=()=>null,Trash2=Dt;
function billCargoPickups(accessToken,body){return z('/warehouse/goods-arrivals/bill-cargo',{accessToken,method:'POST',body})}
function updateCargoPickup(accessToken,id,body){return z('/warehouse/goods-arrivals/'+id+'/cargo',{accessToken,method:'PATCH',body})}`;
const bundle=esbuild.buildSync({stdin:{contents:preamble+body,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__CargoArrival',minify:true,jsx:'transform',jsxFactory:'x.createElement',jsxFragment:'x.Fragment'}).outputFiles[0].text;
s=s.slice(0,target.getStart(webAst))+'function W8(props){return x.createElement(__CargoArrival.GoodsArrivalPanel,props)}'+s.slice(target.end)+'\n'+bundle;
save('web-payload/assets/'+next,s);html=html.replaceAll('/assets/'+old,'/assets/'+next);save('web-payload/index.html',html);
assert.equal((html.match(/<script type="module" crossorigin src=/g)||[]).length,1);
for(const dir of ['api-payload','web-payload'])for(const f of fs.readdirSync(r+'/'+dir,{recursive:true}))if(f.endsWith('.js'))assert.equal(ts.createSourceFile(f,read(r+'/'+dir+'/'+f),99,true).parseDiagnostics.length,0,f);
console.log('Prepared exact API5/web2 overlay');
