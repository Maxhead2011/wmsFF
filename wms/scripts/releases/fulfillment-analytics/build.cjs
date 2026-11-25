const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../../../..'),r=path.resolve(process.argv[2]||'');assert(process.argv[2],'Pass a fresh release directory with api/ and web-base/');const ts=require(repo+'/wms/node_modules/typescript');
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true};
const compile=s=>ts.transpileModule(s,{compilerOptions:options}).outputText;
const normalize=s=>s.replace(/\r\n/g,'\n').trim();
const files=[];
function edit(rel,before,after){const file=path.join(r,'api',rel);let s=fs.readFileSync(file,'utf8');assert.equal(s.split(before).length,2,rel+' anchor');s=s.replace(before,after);fs.writeFileSync(file,s);if(!files.includes(rel))files.push(rel);}
// FIX: only new isolated modules are compiled wholesale. Existing common modules use unique anchors.
for(const name of ['fulfillment-math','fulfillment.service','fulfillment.controller']){
 const rel='modules/analytics/'+name+'.js';assert(!fs.existsSync(path.join(r,'api',rel)));fs.writeFileSync(path.join(r,'api',rel),compile(fs.readFileSync(repo+'/wms/apps/api/src/modules/analytics/'+name+'.ts','utf8')));files.push(rel);
}
const modulePath='wms/apps/api/src/modules/analytics/analytics.module.ts';
assert.equal(normalize(compile(cp.execFileSync('git',['show','1b86c897:'+modulePath],{cwd:repo,encoding:'utf8'}))),normalize(fs.readFileSync(r+'/api/modules/analytics/analytics.module.js','utf8')),'AnalyticsModule source parity');
fs.writeFileSync(r+'/api/modules/analytics/analytics.module.js',compile(fs.readFileSync(repo+'/'+modulePath,'utf8')));files.push('modules/analytics/analytics.module.js');
for(const rel of ['modules/auth/auth.service.js','modules/auth/guards/auth.guard.js'])edit(rel,'analyticsEnabled: user.analyticsEnabled,',"analyticsEnabled: user.analyticsEnabled,\n            fulfillmentAnalyticsEnabled: process.env.WMS_FULFILLMENT_ANALYTICS_ENABLED === 'true',");
const registry=fs.readFileSync(r+"/api/modules/administration/administration-internal-api.service.js","utf8");const group=registry.match(/id: 'analytics',[\s\S]*?routeCount: 4,/);assert(group);edit("modules/administration/administration-internal-api.service.js",group[0],group[0].replace("prefixes: ['/analytics']","prefixes: ['/analytics', '/analytics/fulfillment']").replace("routeCount: 4,","routeCount: 6,"));
fs.writeFileSync(r+'/api-changes.json',JSON.stringify(files));
const hostName='assets/wb-request-host-20261125.js',newHost='assets/fulfillment-host-20261125.js',oldAnalytics='assets/admin-tiles-20261019-26.js',newAnalytics='assets/fulfillment-analytics-20261125.js';
let host=fs.readFileSync(r+'/web-base/'+hostName,'utf8');
const gate='n.requiresAnalyticsAccess&&!t.analyticsEnabled';assert.equal(host.split(gate).length,2);host=host.replace(gate,gate+'&&!t.fulfillmentAnalyticsEnabled');assert.equal(host.split(oldAnalytics.slice(7)).length,3);host=host.replaceAll(oldAnalytics.slice(7),newAnalytics.slice(7));
const web=r+'/web';fs.mkdirSync(web+'/assets',{recursive:true});fs.writeFileSync(web+'/'+newHost,host);
const strip=s=>s.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const component=fs.readFileSync(repo+'/wms/apps/web/src/components/analytics/FulfillmentPanel.tsx','utf8');
const wrapper=fs.readFileSync(repo+'/wms/apps/web/src/components/analytics/AnalyticsPanel.tsx','utf8').split('export function AnalyticsPanel(')[1];assert(wrapper);
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React,jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}}).outputText;
// Preserve the published WB implementation, including its live chart overlays.
const bundle=`import {r as React,A as request} from './${newHost.slice(7)}';\nimport {AnalyticsPanel as WildberriesAnalyticsPanel} from './${oldAnalytics.slice(7)}';\nconst {useEffect,useMemo,useState}=React;\n`+transpile(strip(component)+'\nfunction AnalyticsPanel('+wrapper)+'\nexport {AnalyticsPanel};\n';
fs.writeFileSync(web+'/'+newAnalytics,bundle);fs.copyFileSync(repo+'/wms/apps/web/src/components/analytics/fulfillment.css',web+'/assets/fulfillment-analytics-20261125.css');
let html=fs.readFileSync(r+'/web-base/index.html','utf8');const m=html.match(/(<script type="importmap">)([\s\S]*?)(<\/script>)/);assert(m);const map=JSON.parse(m[2]);let aliases=0;
for(const key of Object.keys(map.imports))if(map.imports[key]==='/'+hostName){map.imports[key]='/'+newHost;aliases++;}
assert(aliases>0);map.imports['/'+hostName]='/'+newHost;assert(!map.imports['/'+oldAnalytics],'Original WB module must remain independently reachable');
html=html.replace(m[0],m[1]+JSON.stringify(map)+m[3]).replaceAll('src="/'+hostName+'"','src="/'+newHost+'"').replace('</head>','<link rel="stylesheet" href="/assets/fulfillment-analytics-20261125.css"></head>');fs.writeFileSync(web+'/index.html',html);
fs.writeFileSync(r+'/web-changes.json',JSON.stringify(['index.html',newHost,newAnalytics,'assets/fulfillment-analytics-20261125.css']));
console.log(JSON.stringify({api:files,web:JSON.parse(fs.readFileSync(r+'/web-changes.json')),hostAliases:aliases,originalWbPreserved:true}));
