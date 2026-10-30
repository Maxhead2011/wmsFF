// FIX: preserve the deployed module graph, execution and submission implementations.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=path.resolve(process.argv[2]),w=path.resolve(__dirname,'../../..'),name='fbo-modal-rows-20261029';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const pins={
 'index.html':'685ddcdc461dcee2e2fd57c645450312a5c763f6731a295e5ad83e712de3b8bf',
 'assets/ozon-all-clients-20261029.js':'155972f89b97249d7a352fc2ad891f52918ce8b0c2be33ab386c2fc44cb39a91',
 'assets/lamoda-blank-price-20261029.js':'b8fc98b54fca59b119cf6bf626f04a73fcf2a8f9b69bb0a4185da52accffbec8',
 'assets/lamoda-print-host-20261028.js':'7f96cd2c4c67ce9cf4d96727ae4fc96f09cd3564bfd838c6d7010384d83c8b1e'};
const read=n=>{const b=fs.readFileSync(root+'/web-base/'+n);assert.equal(sha(b),pins[n],n);return b.toString('utf8')};
const ast=(s,n='host.js')=>ts.createSourceFile(n,s,99,true,n.endsWith('tsx')?ts.ScriptKind.TSX:n.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
function find(s,predicate){const a=ast(s),found=[];function visit(n){if(predicate(n,a))found.push(n);ts.forEachChild(n,visit)}visit(a);assert.equal(found.length,1);return{a,n:found[0]};}
function swap(s,old,next){return s.slice(0,old.n.getStart(old.a))+next+s.slice(old.n.end)}
function once(s,old,next){assert.equal(s.split(old).length,2,old);return s.replace(old,next)}
const sourceHashes={};function source(n){const b=fs.readFileSync(w+'/apps/web/src/'+n);sourceHashes[n]=sha(b);return b.toString('utf8')}
function body(n){const s=source(n),a=ast(s,n);return a.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(a)).join('\n')}
function build(contents,globalName){return esbuild.buildSync({stdin:{contents,loader:'tsx'},bundle:true,write:false,format:'iife',globalName,minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text}
function save(n,s){if(n.endsWith('.js'))assert.equal(ast(s).parseDiagnostics.length,0,n);const p=root+'/web/payload/'+n;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)}
const modal=body('components/client-requests/FboWorkspaceModal.tsx');
const hooks='const {useState,useEffect,useRef}=React;';
const apiSource=source('lib/api.ts'),apiAst=ast(apiSource,'api.ts');
const fetchRequests=apiAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='fetchOzonCustomerRequests');assert(fetchRequests);
const ozonHelpers=`const React=e;${hooks}
 const useRememberedClientId=J,fetchFboPlan=Z,OzonAssemblySupply=M,OzonCustomerImport=__OzonImportLinks.OzonCustomerImport;
 const fetchWorkspaceClients=__MW.fetchWorkspaceClients,OzonEditCountdown=__Deadline.OzonEditCountdown;
 const RequestRemovalProvider=__Removal.RequestRemovalProvider,RequestRemovalButton=__Removal.RequestRemovalButton;
 async function request(url,{accessToken}){const response=await fetch('/api/v1'+url,{headers:{Authorization:'Bearer '+accessToken}});const value=await response.json();if(!response.ok)throw Error(Array.isArray(value.message)?value.message.join('; '):value.message??('HTTP '+response.status));return value;}
 `;
const ozonCompiled=build(ozonHelpers+fetchRequests.getText(apiAst)+'\n'+modal+'\n'+body('components/ozon-fbo/OzonAssemblyList.tsx')+'\n'+body('components/ozon-fbo/OzonCustomerWorkspace.tsx'),'__OzonWarehouse');
const oldOzon='assets/ozon-all-clients-20261029.js',ozon=read(oldOzon);
const ozonNode=find(ozon,(n,a)=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(a)==='__OzonWarehouse'));
save('assets/fbo-modal-rows-ozon-20261029.js',swap(ozon,ozonNode,ozonCompiled));
const aliases={fetchWorkspaceClients:'qe',workspaceEnabled:'xe',fetchClients:'xt',fetchLamodaAccounts:'we',fetchLamodaOverview:'Jt',createLamodaAccount:'tt',checkLamodaAccount:'rt',syncLamoda:'er',fetchLamodaCandidates:'bt',linkLamodaProduct:'tr',importLamodaPlan:'ar',previewLamodaPlan:'at',downloadLamodaTemplate:'rr',fetchLamodaWarehouses:'Zt',updateLamodaAccount:'Ee',importLamodaShipment:'pr',createLamodaAssembly:'gr',fetchFboPlan:'_e',LamodaSubmissionPanel:'zr',FboTwoStagePanel:'Jr',LamodaStockReview:'ea',RequestRemovalProvider:'aa',RequestRemovalButton:'na'};
const lamodaHelpers='const React=me;'+hooks+'const '+Object.entries(aliases).map(([key,value])=>key+'='+value).join(',')+';';
const lamodaCompiled=build(lamodaHelpers+modal+'\n'+body('components/lamoda/LamodaAssemblyList.tsx')+'\n'+body('components/lamoda/LamodaPanel.tsx'),'__LamodaRows');
const oldLamoda='assets/lamoda-blank-price-20261029.js',lamoda=read(oldLamoda);
const lamodaNode=find(lamoda,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='sa');
// Late initialization preserves the host's ge/le/ft initialization order and API aliases.
const lamodaReplacement='var __LamodaModalRows;function sa(props){if(!__LamodaModalRows){'+lamodaCompiled+';__LamodaModalRows=__LamodaRows;}return __LamodaModalRows.LamodaPanel(props);}';
save('assets/fbo-modal-rows-lamoda-20261029.js',swap(lamoda,lamodaNode,lamodaReplacement));
const oldCore='assets/lamoda-print-host-20261028.js',core=read(oldCore);
const oldSelector='.online-execution-modal__header, .fbs-assembly-dialog__heading',newSelector=oldSelector+', .fbo-inline-execution__header';
const pantherSource=source('components/layout/PantheraWorkspaces.tsx');assert(pantherSource.includes(newSelector));
// Compile only the observer's header lookup/existing-entry guard from source.
const pantherAst=ast(pantherSource,'panthera.tsx'),callbacks=[];
function locate(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='forEach'&&n.expression.expression.getText(pantherAst).includes("'.online-execution-modal, .fbs-assembly-dialog-backdrop'"))callbacks.push(n.arguments[0]);ts.forEachChild(n,locate)}locate(pantherAst);assert.equal(callbacks.length,1);
const statements=callbacks[0].body.statements,titleIndex=statements.findIndex(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(pantherAst)==='title'));
assert.equal(titleIndex,4);const prefix=statements.slice(0,titleIndex).map(n=>n.getText(pantherAst)).join('\n');
assert(prefix.includes('entries.get(element)')&&prefix.includes('header.contains(existing.button)'));
const emitted=ts.transpileModule(prefix,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const renamed=ts.transform(ast(emitted),[context=>node=>{
 const names={entries:'e',element:'s',header:'d'};
 function visit(n){if(ts.isIdentifier(n)&&names[n.text]&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n))return ts.factory.createIdentifier(names[n.text]);return ts.visitEachChild(n,visit,context)}return ts.visitNode(node,visit);
}]);
const newCorePrefix=ts.createPrinter().printFile(renamed.transformed[0]);renamed.dispose();
const oldCorePrefix='if(e.has(s))return;let d=s.querySelector("'+oldSelector+'");if(!d)return;';
save('assets/fbo-modal-rows-core-20261029.js',once(core,oldCorePrefix,newCorePrefix));
const cssFiles=['components/client-requests/fbo-workspace-modal.css','components/lamoda/lamoda-assembly-list.css'];
save('assets/'+name+'.css',cssFiles.map(source).join('\n'));
let html=read('index.html'),match=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(match);const map=JSON.parse(match[1]);
const remap={[oldOzon]:'assets/fbo-modal-rows-ozon-20261029.js',[oldLamoda]:'assets/fbo-modal-rows-lamoda-20261029.js',[oldCore]:'assets/fbo-modal-rows-core-20261029.js'};
assert.equal(map.imports['/assets/admin-tiles-20261019-14.js'],'/'+oldOzon);assert.equal(map.imports['/assets/admin-tiles-20261019-15.js'],'/'+oldLamoda);assert.equal(map.imports['/assets/admin-tiles-20261019-0.js'],'/'+oldCore);
for(const[old,next]of Object.entries(remap)){for(const key of Object.keys(map.imports))if(map.imports[key]==='/'+old)map.imports[key]='/'+next;map.imports['/'+old]='/'+next;}
html=html.replace(match[1],JSON.stringify(map));html=once(html,'src="/'+oldCore+'"','src="/'+remap[oldCore]+'"');
html=once(html,'</head>','<link rel="stylesheet" href="/assets/'+name+'.css"></head>');save('index.html',html);
fs.writeFileSync(root+'/patch-proof.json',JSON.stringify({sourceHashes,baseHashes:pins,changes:{ozon:'__OzonWarehouse only',lamoda:'sa only with lazy local wrapper',core:'header selector and existing minimize button reattachment'},corePatch:{before:oldCorePrefix,after:newCorePrefix},retainedRuntime:['OzonImport','OzonSupply','OzonAPIPlan','OzonCountdown','LamodaSubmission','LamodaStockReview','FboTwoStagePanel','all API helpers'],singleReactGraph:true},null,2));
console.log('Five-file web overlay prepared; source/API/shared execution graph retained.');
