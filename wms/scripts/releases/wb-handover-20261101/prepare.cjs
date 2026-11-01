const fs=require('fs'),path=require('path'),ts=require('../../../node_modules/typescript'),assert=require('assert/strict');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const r='D:/WMSFF/_Kof/work/wb-handover-release-20261101';
const save=(n,s)=>{fs.mkdirSync(path.dirname(r+'/'+n),{recursive:true});fs.writeFileSync(r+'/'+n,s)};
const n='modules/client-requests/wb-fbo-supply.service.js';
const compiled=ts.transpileModule(fs.readFileSync('wms/apps/api/src/modules/client-requests/wb-fbo-supply.service.ts','utf8'),{compilerOptions:{target:9,module:1,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
let live=fs.readFileSync(r+'/api-live/'+n,'utf8');
function methods(s){const a=ts.createSourceFile('x.js',s,99,true),result={};function walk(n){if(ts.isMethodDeclaration(n))result[n.name.getText(a)]={start:n.getStart(a),end:n.end,text:n.getText(a)};ts.forEachChild(n,walk)}walk(a);return result}
const c=methods(compiled),l=methods(live);assert(l.refresh&&!l.completeConfirmed&&l.bindingQuantity);
live=live.slice(0,l.refresh.start)+c.refresh.text+'\n'+c.completeConfirmed.text+live.slice(l.refresh.end);
save('api-payload/'+n,live);
let html=fs.readFileSync(r+'/web-base/index.html','utf8'),old='/assets/wb-supply-actual-20261101.js',next='/assets/wb-gate-completion-20261101.js';assert(html.includes(old));
let s=fs.readFileSync(r+'/web-base'+old,'utf8'),a=ts.createSourceFile('x.js',s,99,true),target;
function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(a)==='__WbActualBinding')target=n.initializer;ts.forEachChild(n,walk)}walk(a);assert(target);
const src=fs.readFileSync('wms/apps/web/src/components/client-requests/WbFboSupply.tsx','utf8')+'\n'+fs.readFileSync('wms/apps/web/src/components/client-requests/fboProcess.ts','utf8').replace(':requestStatusOptions',':Ea');
const ast=ts.createSourceFile('x.tsx',src,99,true,4),body=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n');
const bundle=esbuild.buildSync({stdin:{contents:'const React={get Fragment(){return o.Fragment},createElement:(...a)=>o.createElement(...a)};const useState=(...a)=>o.useState(...a),useEffect=(...a)=>o.useEffect(...a);'+body,loader:'tsx'},write:false,format:'iife',globalName:'__WbGateFinal',minify:true,jsx:'transform',jsxFactory:'React.createElement'}).outputFiles[0].text;
s=bundle+'\n'+s.slice(0,target.getStart(a))+'__WbGateFinal'+s.slice(target.end);assert(!ts.createSourceFile('a.js',s,99,true).parseDiagnostics.length);
save('web-payload'+next,s);save('web-payload/index.html',html.replaceAll(old,next));console.log('Prepared API1/web2');
