const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=path.resolve(process.argv[2]),w=path.resolve(__dirname,'../../..');
const read=n=>fs.readFileSync(n,'utf8'),save=(n,s)=>{const p=root+'/'+n;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
const ast=(s,n='x.js')=>ts.createSourceFile(n,s,99,true,n.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.JS);
function compile(n){return ts.transpileModule(read(w+'/apps/api/src/'+n),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;}
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
function method(s,name){const a=ast(s);let found;function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(a)===name)found=n.getText(a);ts.forEachChild(n,visit);}visit(a);assert(found,name);return found;}
let n='modules/client-requests/ozon-assembly-supply.service.js',s=read(root+'/api-base/'+n);s=once(s,'    async cargoMappingFile(',method(compile(n.replace('.js','.ts')),'labelDownload')+'\n    async cargoMappingFile(');save('api/payload/'+n,s);
n='modules/client-requests/ozon-assembly-supply.controller.js';s=read(root+'/api-base/'+n);s=once(s,'    labels(',"    labelDownload(id,body,user){return this.service.labelDownload(id,body.supplyId,user);}\n    labels(");
const start=s.lastIndexOf('__decorate([',s.indexOf("(0, common_1.Post)('labels')")),end=s.indexOf('], OzonAssemblySupplyController.prototype, "labels", null);',start)+'], OzonAssemblySupplyController.prototype, "labels", null);'.length;
s=s.slice(0,end)+'\n'+s.slice(start,end).replace("('labels')","('label-download')").replace('"labels", null','"labelDownload", null')+s.slice(end);save('api/payload/'+n,s);
n='modules/administration/administration-internal-api.service.js';s=read(root+'/api-base/'+n);const offset=s.indexOf("id: 'client-requests'");assert(offset>0);let tail=s.slice(offset);tail=once(tail.slice(0,tail.indexOf("id: 'clients'")), 'routeCount: 58','routeCount: 59')+tail.slice(tail.indexOf("id: 'clients'"));save('api/payload/'+n,s.slice(0,offset)+tail);
n='modules/tsd/ozon-label-control.js';save('api/payload/'+n,compile(n.replace('.js','.ts')));
n='modules/client-requests/ozon-supply-policy.js';s=read(root+'/api-base/'+n);s="const ozonLabelControl=require('../tsd/ozon-label-control');\n"+s;
s=once(s,'!b.closedAt || !b.confirmedAt','!b.closedAt || (!ozonLabelControl.ozonLabelControlEnabled()&&!b.confirmedAt)');
s=once(s,"action !== 'FINISH'","action !== 'FINISH' && !(ozonLabelControl.ozonLabelControlEnabled()&&action==='CONFIRM_BOX')");save('api/payload/'+n,s);
n='modules/tsd/fbo-two-stage.service.js';s=read(root+'/api-base/'+n);s="const ozonLabelControl=require('./ozon-label-control');\n"+s;
s=once(s,'            parallelPackingSupported:',"            ozonLabelControlRequired:!!ozonShipment&&ozonLabelControl.ozonLabelControlEnabled()&&assembly?.phase!=='COMPLETED',\n            parallelPackingSupported:");
s=once(s,'confirmed: !!b.confirmedAt,',"confirmed:ozonShipment&&ozonLabelControl.ozonLabelControlEnabled()&&assembly?.phase!=='COMPLETED'?ozonLabelControl.ozonBoxLabelConfirmed(ozonShipment.integration,b):!!b.confirmedAt,");
s=once(s,'if (b.confirmedAt)',"if (ozonShipment&&ozonLabelControl.ozonLabelControlEnabled()?ozonLabelControl.ozonBoxLabelConfirmed(ozonShipment.integration,b):b.confirmedAt)");
s=once(s,'await tx.fboAssemblyBox.update({ where: { id: b.id }, data: { confirmedAt: new Date(), confirmedByUserId: user.id } });',"if(ozonShipment&&ozonLabelControl.ozonLabelControlEnabled())await ozonLabelControl.confirmOzonBoxLabel(tx,{...ozonShipment,clientId:r.clientId},b,dto.barcode,user.id);\n                    await tx.fboAssemblyBox.update({ where: { id: b.id }, data: { confirmedAt: new Date(), confirmedByUserId: user.id } });");
s=once(s,'if (!boxes.length || boxes.some(b => !b.confirmedAt) || lines.some(l => l.packed !== l.needed))',"if(ozonShipment&&ozonLabelControl.ozonLabelControlEnabled()&&boxes.some(b=>!ozonLabelControl.ozonBoxLabelConfirmed(ozonShipment.integration,b)))throw new common_1.ConflictException('Проверьте каждый короб: наш ШК и стикер Ozon.');\n                    if (!boxes.length || boxes.some(b => !b.confirmedAt) || lines.some(l => l.packed !== l.needed))");save('api/payload/'+n,s);
function body(file){const s=read(w+'/apps/web/src/'+file),a=ast(s,file);return a.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(a)).join('\n');}
const boiler=read(__dirname+'/api-boilerplate.txt');
function bundle(files,name,extra=''){return esbuild.buildSync({stdin:{contents:boiler+extra+files.map(body).join('\n'),loader:'tsx'},bundle:true,write:false,format:'iife',globalName:name,minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;}
function replaceVar(s,name,code){const a=ast(s);let found=[];function visit(n){if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(a)===name))found.push(n);ts.forEachChild(n,visit);}visit(a);assert.equal(found.length,1,name);const n=found[0];return s.slice(0,n.getStart(a))+code+s.slice(n.end);}
const old='assets/fbo-progress-ozon-20261030.js',next='assets/ozon-label-control-20261030.js';s=read(root+'/web-base/'+old);
const files=['components/client-requests/OzonImportStockReview.tsx','components/client-requests/OzonStockAdjustment.tsx','components/ozon-fbo/OzonAssemblySupply.tsx','components/client-requests/OzonImportCorrection.tsx','components/client-requests/OzonLinkImport.tsx','components/client-requests/OzonCustomerImport.tsx'];
s=replaceVar(s,'__OzonImportLinks',bundle(files,'__OzonImportLinks'));
s=replaceVar(s,'__OzonSupplyLayout',bundle(['components/ozon-fbo/OzonAssemblySupply.tsx'],'__OzonSupplyLayout','const ozonCabinetLabel=__OzonImportLinks.ozonCabinetLabel;'));
save('web/payload/'+next,s);
let html=read(root+'/web-base/index.html'),m=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(m[1]);
for(const k of Object.keys(map.imports))if(map.imports[k]==='/'+old)map.imports[k]='/'+next;map.imports['/'+old]='/'+next;
// FIX: preserve all surrounding runtime code; change only timestamp formatting in the timeline.
const core='assets/receipt-progress-20261030.js',coreNext='assets/ozon-label-history-core-20261030.js';s=read(root+'/web-base/'+core);let a=ast(s),found=[];function walk(n){if(ts.isFunctionDeclaration(n)&&n.getText(a).includes('client-request-timeline-modal__header'))found.push(n);ts.forEachChild(n,walk);}walk(a);assert.equal(found.length,1);let f=found[0],part=f.getText(a),count=0;
part=part.replace(/\b[\w$]+\(([\w$]+\.createdAt)\)/g,(all,arg)=>{if(all.startsWith("Date("))return all;count++;return `(new Date(${arg}).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' МСК')`;});assert.equal(count,2);
s=s.slice(0,f.getStart(a))+part+s.slice(f.end);save('web/payload/'+coreNext,s);for(const k of Object.keys(map.imports))if(map.imports[k]==='/'+core)map.imports[k]='/'+coreNext;map.imports['/'+core]='/'+coreNext;
// FIX: script src is not resolved by import maps. Both paths must start the same module.
html=once(html,`src="/${core}"`,`src="/${coreNext}"`);
html=html.replace(m[1],JSON.stringify(map));save('web/payload/index.html',html);
for(const dir of ['api/payload','web/payload'])for(const file of fs.readdirSync(root+'/'+dir,{recursive:true}))if(file.endsWith('.js'))assert.equal(ast(read(root+'/'+dir+'/'+file)).parseDiagnostics.length,0,file);
console.log('Exact API and web overlays prepared');
