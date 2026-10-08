// FIX: build a delta from supplied verified live assets; never replace the application with old TS.
const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
const {patch}=require('./print-series-web-patch.cjs');
const {repair}=require('./single-react-graph.cjs');
const [web,api,out]=process.argv.slice(2);if(!web||!api||!out||fs.existsSync(out))throw Error('Supply verified web/API directories and a NEW output directory');
const root=path.resolve(__dirname,'..');fs.mkdirSync(out,{recursive:true});
const write=(name,data)=>{const p=path.join(out,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data)};
const cache={};const files=new Proxy(cache,{get(target,n){if(!(n in target)){const p=path.join(web,n);target[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return target[n];}});
const entry=files['index.html'].match(/src="\/assets\/([^" ]+\.js)"/)[1];
const graph=repair(files,entry,entry,'print-phone-20261008');
let patched=0;
for(const [name,code]of Object.entries(graph)){
 let next=code;
 if(code.includes('startsWith("AGENT:")')&&code.includes('В агент печати отправлено')){next=patch(code);patched++;}
 if(name==='index.html')next=next.replace('</head>','<link rel="stylesheet" href="/assets/phone-layout-20261008.css"><script src="/assets/print-phone-bridge-20261008.js"></script></head>');
 write('web/'+name,next);
}
if(patched!==1)throw Error('Serial screen not found exactly once');
write('web/assets/phone-layout-20261008.css',fs.readFileSync(path.join(root,'apps/web/src/components/layout/phone-layout.css')));
// Bundle the framework-free bridge; do not introduce a second React runtime.
require(require.resolve('esbuild',{paths:[path.dirname(require.resolve('../apps/web/node_modules/vite'))]})).buildSync({entryPoints:[path.join(root,'apps/web/src/lib/printSeriesRuntime.ts')],bundle:true,format:'iife',target:'es2020',outfile:path.join(out,'web/assets/print-phone-bridge-20261008.js')});
for(const name of ['print-series.service','print-series.controller']){
 const source=fs.readFileSync(path.join(root,'apps/api/src/modules/print',name+'.ts'),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}});
 write('api/modules/print/'+name+'.js',compiled.outputText);
}
let moduleText=fs.readFileSync(path.join(api,'modules/print/print.module.js'),'utf8');
if(moduleText.includes('PrintSeriesService'))throw Error('Candidate already has series code');
moduleText=moduleText.replace('"use strict";', '"use strict";\nconst print_series_service_1=require("./print-series.service");\nconst print_series_controller_1=require("./print-series.controller");');
for(const [field,symbol]of [['controllers','print_series_controller_1.PrintSeriesController'],['providers','print_series_service_1.PrintSeriesService']]){
 const re=new RegExp('('+field+': \\[)([^\\]]+)(\\])');if(!re.test(moduleText))throw Error('Unrecognized module registration');moduleText=moduleText.replace(re,'$1$2, '+symbol+'$3');
}
write('api/modules/print/print.module.js',moduleText);
const registryPath='modules/administration/administration-internal-api.service.js';
let registry=fs.readFileSync(path.join(api,registryPath),'utf8');
const registryAst=ts.createSourceFile('registry.js',registry,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let edits=[];
function registryWalk(n){if(ts.isObjectLiteralExpression(n)&&n.properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(registryAst)==='id'&&p.initializer.getText(registryAst).replace(/['"]/g,'')==='print')){
 const prefixes=n.properties.find(p=>p.name?.getText(registryAst)==='prefixes');const count=n.properties.find(p=>p.name?.getText(registryAst)==='routeCount');
 if(!prefixes||!count||prefixes.initializer.getText(registryAst).includes('/print/series'))throw Error('Unexpected API registry');
 edits.push([prefixes.initializer.end-1,prefixes.initializer.end-1,', "/print/series"']);edits.push([count.initializer.getStart(registryAst),count.initializer.end,String(Number(count.initializer.getText(registryAst))+5)]);
}ts.forEachChild(n,registryWalk);}registryWalk(registryAst);
if(edits.length!==2)throw Error('Print registry not found');for(const [start,end,value]of edits.sort((a,b)=>b[0]-a[0]))registry=registry.slice(0,start)+value+registry.slice(end);
write('api/'+registryPath,registry);
write('candidate.json',JSON.stringify({api:['modules/print/print-series.service.js','modules/print/print-series.controller.js','modules/print/print.module.js',registryPath],web:Object.keys(graph).concat(['assets/phone-layout-20261008.css','assets/print-phone-bridge-20261008.js']),requiredFlag:'WMS_PRINT_SERIES_ENABLED=true',sourceParityVerified:false},null,2));
console.log('Candidate delta built; no deployment performed');
