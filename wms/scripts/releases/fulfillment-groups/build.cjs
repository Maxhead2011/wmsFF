// FIX: exact analytics-only overlay; compare the previous source against pinned production before replacement.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../../../..'),r=path.resolve(process.argv[2]||'');assert(process.argv[2]);
const ts=require(repo+'/wms/node_modules/typescript'),options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true};
const compile=s=>ts.transpileModule(s,{compilerOptions:options}).outputText,normalize=s=>s.replace(/\r\n/g,'\n').trim();
const files=[];
for(const name of ['fulfillment-math','fulfillment.service','fulfillment-groups']){
 const source='wms/apps/api/src/modules/analytics/'+name+'.ts',rel='modules/analytics/'+name+'.js',dest=r+'/api/'+rel;
 if(fs.existsSync(dest))assert.equal(normalize(compile(cp.execFileSync('git',['show','fc28c1d5:'+source],{cwd:repo,encoding:'utf8'}))),normalize(fs.readFileSync(dest,'utf8')),name+' published source parity');
 else assert.equal(name,'fulfillment-groups');
 const compiled=compile(fs.readFileSync(repo+'/'+source,'utf8'));
 if(!fs.existsSync(dest)||normalize(fs.readFileSync(dest,'utf8'))!==normalize(compiled)){fs.writeFileSync(dest,compiled);files.push(rel);}
}
fs.writeFileSync(r+'/api-changes.json',JSON.stringify(files));
const oldHost='assets/fulfillment-host-20261125.js',hostName='assets/fulfillment-groups-host-20261125.js',oldModule='fulfillment-analytics-20261125.js',moduleName='fulfillment-groups-20261125.js';
let host=fs.readFileSync(r+'/web-base/'+oldHost,'utf8');assert.equal(host.split(oldModule).length,3);host=host.replaceAll(oldModule,moduleName);
const web=r+'/web';fs.mkdirSync(web+'/assets',{recursive:true});fs.writeFileSync(web+'/'+hostName,host);
const strip=s=>s.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const component=fs.readFileSync(repo+'/wms/apps/web/src/components/analytics/FulfillmentPanel.tsx','utf8');
const wrapper=fs.readFileSync(repo+'/wms/apps/web/src/components/analytics/AnalyticsPanel.tsx','utf8').split('export function AnalyticsPanel(')[1];assert(wrapper);
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React,jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}}).outputText;
fs.writeFileSync(web+'/assets/'+moduleName,`import {r as React,A as request} from './${hostName.slice(7)}';\nimport {AnalyticsPanel as WildberriesAnalyticsPanel} from './admin-tiles-20261019-26.js';\nconst {useEffect,useMemo,useState}=React;\n`+transpile(strip(component)+'\nfunction AnalyticsPanel('+wrapper)+'\nexport {AnalyticsPanel};\n');
const css='assets/fulfillment-groups-20261125.css';fs.copyFileSync(repo+'/wms/apps/web/src/components/analytics/fulfillment.css',web+'/'+css);
let html=fs.readFileSync(r+'/web-base/index.html','utf8');const m=html.match(/(<script type="importmap">)([\s\S]*?)(<\/script>)/);assert(m);const map=JSON.parse(m[2]);let aliases=0;
for(const key of Object.keys(map.imports))if(map.imports[key]==='/'+oldHost){map.imports[key]='/'+hostName;aliases++;}
assert(aliases>0);map.imports['/'+oldHost]='/'+hostName;
html=html.replace(m[0],m[1]+JSON.stringify(map)+m[3]).replaceAll('src="/'+oldHost+'"','src="/'+hostName+'"');
assert.equal(html.split('/assets/fulfillment-analytics-20261125.css').length,2);html=html.replace('/assets/fulfillment-analytics-20261125.css','/'+css);fs.writeFileSync(web+'/index.html',html);
fs.writeFileSync(r+'/web-changes.json',JSON.stringify(['index.html',hostName,'assets/'+moduleName,css]));
console.log(JSON.stringify({api:files,web:JSON.parse(fs.readFileSync(r+'/web-changes.json')),hostAliases:aliases,originalWbPreserved:true}));
