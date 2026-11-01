const fs=require('fs'),ts=require('../../../node_modules/typescript'),path=require('path');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const r='D:/WMSFF/_Kof/work/wb-bind-release-20261101';
const save=(n,s)=>{fs.mkdirSync(path.dirname(r+'/'+n),{recursive:true});fs.writeFileSync(r+'/'+n,s)};
const source=fs.readFileSync('wms/apps/api/src/modules/client-requests/wb-fbo-supply.service.ts','utf8');
save('api-payload/modules/client-requests/wb-fbo-supply.service.js',ts.transpileModule(source,{compilerOptions:{target:9,module:1,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText);
let s=fs.readFileSync(r+'/web-base/assets/wb-supply-pr833.js','utf8'),ast=ts.createSourceFile('x.js',s,99,true,1),target;
function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='__WbTracking')target=n.initializer;ts.forEachChild(n,walk)}walk(ast);if(!target)throw Error('tracking module absent');
let src=fs.readFileSync('wms/apps/web/src/components/client-requests/WbFboSupply.tsx','utf8')+'\n'+fs.readFileSync('wms/apps/web/src/components/client-requests/fboProcess.ts','utf8').replace(':requestStatusOptions',':Ea');
let a=ts.createSourceFile('x.tsx',src,99,true,4),body=a.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(a)).join('\n');
const bundle=esbuild.buildSync({stdin:{contents:'const React={get Fragment(){return o.Fragment},createElement:(...a)=>o.createElement(...a)};const useState=(...a)=>o.useState(...a),useEffect=(...a)=>o.useEffect(...a);'+body.replaceAll('\\n','\n'),loader:'tsx'},write:false,format:'iife',globalName:'__WbActualBinding',minify:true,jsx:'transform',jsxFactory:'React.createElement'}).outputFiles[0].text;
s=bundle+'\n'+s.slice(0,target.getStart(ast))+'__WbActualBinding'+s.slice(target.end);
if(ts.createSourceFile('a.js',s,99,true,1).parseDiagnostics.length)throw Error('syntax');
save('web-payload/assets/wb-supply-actual-20261101.js',s);
let html=fs.readFileSync(r+'/web-base/index.html','utf8');if(!html.includes('/assets/wb-supply-pr833.js'))throw Error('map');save('web-payload/index.html',html.replaceAll('/assets/wb-supply-pr833.js','/assets/wb-supply-actual-20261101.js'));
console.log('prepared API1/web2');

