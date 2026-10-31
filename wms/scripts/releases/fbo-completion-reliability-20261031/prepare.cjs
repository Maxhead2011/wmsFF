// FIX: exact seams on the verified live graph; preserve runtime-owned features.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const w=path.resolve(__dirname,'../../..'),ts=require(w+'/node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve(w+'/apps/web/node_modules/vite/package.json'))('esbuild');
const root=path.resolve(process.argv[2]),read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const save=(name,s)=>{const p=root+'/'+name;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,a);return s.replace(a,b)};
const helper='modules/tsd/fbo-completion-batch.js';
save('api-payload/'+helper,ts.transpileModule(read(w+'/apps/api/src/'+helper.replace('.js','.ts')),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
let name='modules/tsd/fbo-two-stage.service.js',s=read(root+'/api-live/'+name);
s+='\nconst completionReliability=require("./fbo-completion-batch");\n';
s=once(s,'                    await clientKizReview.assertClientRequestKizShipment(tx,r,user);','                    if(!completionReliability.fboCompletionBatchEnabled())await clientKizReview.assertClientRequestKizShipment(tx,r,user);');
const start=s.indexOf('                    for (const b of boxes)\n                        await this.validatePackedBox',s.indexOf("else if (dto.action === 'FINISH')"));
const end=s.indexOf('                    await this.stock.packageClientRequest',start);assert(start>0&&end>start);
const old=s.slice(start,end);
s=s.slice(0,start)+`                    let packages;
                    if(completionReliability.fboCompletionBatchEnabled()){
                        await completionReliability.fboCompletionStage(id,'box_validation',()=>completionReliability.validateFboPackedBoxes(tx,r,boxes,units));
                        await completionReliability.fboCompletionStage(id,'kiz_validation',()=>clientKizReview.assertClientRequestKizShipment(tx,r,user));
                        packages=completionReliability.fboCompletionPackages(r,boxes,units);
                        await completionReliability.fboCompletionStage(id,'selections',()=>completionReliability.saveFboCompletionSelections(tx,r,boxes,packages));
                    }else{
`+old.replace('const packages =','packages =')+'                    }\n'+s.slice(end);
s=once(s,'await this.stock.packageClientRequest({ requestId: id, idempotencyKey: `fbo-pack:${id}`, boxes: boxes.length, packedUnits: units.length, packages }, user, tx);','await completionReliability.fboCompletionStage(id,"stock_and_packages",()=>this.stock.packageClientRequest({ requestId: id, idempotencyKey: `fbo-pack:${id}`, boxes: boxes.length, packedUnits: units.length, packages }, user, tx));');
s=once(s,'!fboProgressStatus.fboRetryableTransactionError(error) || attempt >= 2)\n                    throw error;','!fboProgressStatus.fboRetryableTransactionError(error) || attempt >= 2)\n                    throw dto.action===\'FINISH\'?completionReliability.fboCompletionError(error):error;');
assert.equal(ts.createSourceFile('x.js',s,99,true).parseDiagnostics.length,0);save('api-payload/'+name,s);
name='modules/administration/fbo-problems.service.js';s=read(root+'/api-live/'+name);
assert(s.includes('async apply(id, token, user)'));s+='\nrequire("../tsd/fbo-completion-batch").installFboRecoveryReliability(exports.FboProblemsService.prototype);\n';save('api-payload/'+name,s);

(async()=>{
 const aliases={applyFboRecovery:'fn',downloadFboPickReport:'jn',downloadFboRecoveryDocument:'pn',fetchFboPickReport:'xn',fetchFboRecoveryDetails:'Re',fetchFboRecoveryRequests:'Ze',previewFboRecovery:'bn'};
 const bundle=await esbuild.build({entryPoints:[w+'/apps/web/src/components/administration/AdministrationFboProblems.tsx'],bundle:true,write:false,format:'iife',globalName:'__fboReliableUI',jsx:'automatic',minify:false,plugins:[{name:'runtime',setup(b){
  b.onResolve({filter:/^(react|react\/jsx-runtime)$|\/lib\/api$|\.css$/},a=>({path:a.path,namespace:'runtime'}));
  b.onLoad({filter:/.*/,namespace:'runtime'},a=>({contents:a.path.endsWith('.css')?'':a.path==='react'?'export const useState=a.useState,useEffect=a.useEffect,useRef=a.useRef;':a.path==='react/jsx-runtime'?'export const jsx=e.jsx,jsxs=e.jsxs,Fragment=e.Fragment;':Object.entries(aliases).map(([k,v])=>`export const ${k}=${v};`).join('\n'),loader:'js'}));
 }}]});
 const oldName='processing-terms-20261031-2.js',newName='fbo-completion-reliability-20261031.js';s=read(root+'/'+oldName);
 const tree=ts.createSourceFile('base.js',s,99,true),nodes=[];function visit(n){if(ts.isFunctionDeclaration(n)&&n.name.text==='ut')nodes.push(n);ts.forEachChild(n,visit)}visit(tree);assert.equal(nodes.length,1);const node=nodes[0];assert(node.getText(tree).includes('physicalConfirmed'));
 s=s.slice(0,node.getStart(tree))+bundle.outputFiles[0].text+'\nfunction ut(props){return __fboReliableUI.AdministrationFboProblems(props)}\n'+s.slice(node.end);
 assert.equal(ts.createSourceFile('x.js',s,99,true).parseDiagnostics.length,0);save('web-payload/assets/'+newName,s);
 let html=read(root+'/index.html'),match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);
 for(const k in map.imports)if(map.imports[k]==='/assets/'+oldName)map.imports[k]='/assets/'+newName;
 map.imports['/assets/'+oldName]='/assets/'+newName;save('web-payload/index.html',html.replace(match[1],JSON.stringify(map)));
 console.log('Prepared exact3 API/2 web overlay');
})().catch(e=>{console.error(e);process.exitCode=1});

