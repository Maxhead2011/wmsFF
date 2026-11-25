// FIX: exact overlay over the verified production runtime; never replace the full source build.
const fs=require('fs'),path=require('path'),ts=require('typescript');
const root=path.resolve(__dirname,'../../..'),dir=path.resolve(process.argv[2]);
function replace(s,a,b){if(s.split(a).length!==2)throw Error('Expected one anchor: '+a.slice(0,100));return s.replace(a,b);}
fs.mkdirSync(path.join(dir,'delta-v2/api/modules/print'),{recursive:true});fs.mkdirSync(path.join(dir,'delta-v2/api/modules/tsd'),{recursive:true});fs.mkdirSync(path.join(dir,'delta-v2/web/assets'),{recursive:true});
for(const name of ['lamoda-label','lamoda-label-symbols','lamoda-label.service','lamoda-label.controller','lamoda-batch-label','lamoda-relabel-data']) {
 const source=fs.readFileSync(path.join(root,'apps/api/src/modules/print',name+'.ts'),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
 fs.writeFileSync(path.join(dir,'delta-v2/api/modules/print',name+'.js'),js);
}
let moduleJs=fs.readFileSync(path.join(dir,'base-api-v2/modules/print/print.module.js'),'utf8');
moduleJs='const lamoda_label_controller_1=require("./lamoda-label.controller");\n'+replace(moduleJs,'controllers: [','controllers: [lamoda_label_controller_1.LamodaLabelController, ');
fs.writeFileSync(path.join(dir,'delta-v2/api/modules/print/print.module.js'),moduleJs);
let service=fs.readFileSync(path.join(dir,'base-api-v2/modules/tsd/fbo-two-stage.service.js'),'utf8');
service='const lamoda_full_label_1=require("../print/lamoda-label");\nconst lamoda_full_service_1=require("../print/lamoda-label.service");\nconst lamoda_relabel_data_1=require("../print/lamoda-relabel-data");\n'+replace(service,
 'const image = await (0, tsd_relabel_label_1.buildTsdRelabelLabel)(label.barcode, { ...sku, name: label.name, article: label.article, size: label.size }, r.client.name);',
 'const legacyPrint=!label.fullLabel&&await this.prisma.fboAssemblyUnit.count({where:{requestId:id,lamodaRelabelPrintId:{not:null}}});const fullLabel=legacyPrint?null:await lamoda_full_service_1.readLamodaLabel(this.prisma,r.clientId,sku.id,label.barcode,label.article,label.fullLabel,true);\nconst image=fullLabel?await lamoda_full_label_1.lamodaLabelImage(await lamoda_full_label_1.buildLamodaLabelPdf(fullLabel)):await (0, tsd_relabel_label_1.buildTsdRelabelLabel)(label.barcode, { ...sku, name: label.name, article: label.article, size: label.size }, r.client.name);');
service=replace(service,'async resolveLamodaRelabel(', 'async lamodaLabelData(id,user,body){const r=await this.load(this.prisma,id,user,body?"write":"read");this.requireFbo(r);return lamoda_relabel_data_1.lamodaRelabelData(this.prisma,r,user,body); }\nasync resolveLamodaRelabel(');
fs.writeFileSync(path.join(dir,'delta-v2/api/modules/tsd/fbo-two-stage.service.js'),service);
let web=fs.readFileSync(path.join(dir,'web-0.js'),'utf8');
web=replace(web,'try{const V=kf(g),K=C.map','try{if(g==="lamoda"){await __printLamodaLabels(t.accessToken,J.id,C,E,h,P,Vp);H("Этикетки Lamoda 58 × 40 мм подготовлены и переданы выбранному способу печати.");return}const V=kf(g),K=C.map');
web=replace(web,'const M=C[0],ee=M&&J?','const M=C[0],ee=g!=="lamoda"&&M&&J?');
const option='e.jsx("option",{value:"lukin",children:"По образцу Лукина · 60 × 40 мм"})';
web=replace(web,option,option+',e.jsx("option",{value:"lamoda",children:"Лукин · Lamoda · 58 × 40 мм"})');
web='import {printLamodaLabels as __printLamodaLabels} from "/assets/lamoda-label-58x40-20261125.js";\n'+web;
fs.writeFileSync(path.join(dir,'delta-v2/web/assets/lamoda-label-host-20261125.js'),web);
let index=fs.readFileSync(path.join(dir,'index.html'),'utf8');
if(!index.includes('src="/assets/fulfillment-groups-host-20261125.js"'))throw Error('Unexpected web entry');
index=index.replaceAll('/assets/fulfillment-groups-host-20261125.js','/assets/lamoda-label-host-20261125.js');
index=replace(index,'"imports":{','"imports":{"/assets/fulfillment-groups-host-20261125.js":"/assets/lamoda-label-host-20261125.js",');
fs.writeFileSync(path.join(dir,'delta-v2/web/index.html'),index);
require(process.env.ESBUILD_MODULE||'esbuild').buildSync({entryPoints:[path.join(root,'apps/web/src/lib/lamodaLabelPrint.ts')],bundle:true,format:'esm',target:'es2022',minify:true,outfile:path.join(dir,'delta-v2/web/assets/lamoda-label-58x40-20261125.js')});
const controller='lamoda-relabel-data.controller';
fs.writeFileSync(path.join(dir,'delta-v2/api/modules/tsd',controller+'.js'),ts.transpileModule(fs.readFileSync(path.join(root,'apps/api/src/modules/tsd',controller+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText);
let tsd=fs.readFileSync(path.join(dir,'base-api-v2/modules/tsd/tsd.module.js'),'utf8');
tsd='const lamoda_relabel_controller_1=require("./lamoda-relabel-data.controller");\n'+replace(tsd,'controllers: [','controllers: [lamoda_relabel_controller_1.LamodaRelabelDataController, ');
fs.writeFileSync(path.join(dir,'delta-v2/api/modules/tsd/tsd.module.js'),tsd);
fs.mkdirSync(path.join(dir,'delta-v2/api/modules/administration'),{recursive:true});
let admin=fs.readFileSync(path.join(dir,'base-api-v2/modules/administration/administration-internal-api.service.js'),'utf8');
admin=replace(admin,"prefixes: ['/print', '/print/kiz-duplicates', \"/print/series\"]","prefixes: ['/print', '/print/kiz-duplicates', '/print/series', '/print/lamoda']");
admin=replace(admin,'routeCount: 39, // FIX: preserve duplicate KIZ routes','routeCount: 40, // FIX: preserve duplicate KIZ routes');
const tsdStart=admin.indexOf("id: 'tsd'"),tsdEnd=admin.indexOf("id: 'turnover'",tsdStart);let section=admin.slice(tsdStart,tsdEnd);
section=section.replace(/prefixes: \[([^\]]+)\]/,(_,p)=>'prefixes: ['+p+", '/tsd/requests/:id/fbo/lamoda-relabel']").replace(/routeCount: (\d+)/,(_,n)=>'routeCount: '+(Number(n)+2));
admin=admin.slice(0,tsdStart)+section+admin.slice(tsdEnd);fs.writeFileSync(path.join(dir,'delta-v2/api/modules/administration/administration-internal-api.service.js'),admin);
const shim=path.join(dir,'lamoda-react-shim.js'),entry=path.join(dir,'lamoda-relabel-entry.ts');
fs.writeFileSync(shim,'let runtime;export function setRuntime(v){runtime=v}export const React={createElement:(...a)=>runtime.createElement(...a),Fragment:Symbol.for("react.fragment")};export const useState=(...a)=>runtime.useState(...a),useEffect=(...a)=>runtime.useEffect(...a);export default React;');
fs.writeFileSync(entry,`import {setRuntime} from ${JSON.stringify(shim)};import {LamodaRelabelDataForm} from ${JSON.stringify(path.join(root,'apps/web/src/components/client-requests/LamodaRelabelDataForm.tsx'))};export function createLamodaRelabelDataForm(runtime){setRuntime(runtime);return LamodaRelabelDataForm;}`);
require(process.env.ESBUILD_MODULE||'esbuild').buildSync({entryPoints:[entry],bundle:true,format:'esm',target:'es2022',minify:true,alias:{react:shim},inject:[shim],jsx:'transform',jsxFactory:'React.createElement',jsxFragment:'React.Fragment',tsconfigRaw:{compilerOptions:{jsx:'react'}},outfile:path.join(dir,'delta-v2/web/assets/lamoda-relabel-data-20261125.js')});
let workspace=fs.readFileSync(path.join(dir,'yandex-fby-counter-20261108.js'),'utf8');
const start=workspace.indexOf('function $r({plan:t,accessToken:a,disabled:i,command:s,refresh:g})'),end=workspace.indexOf('var ',start);
if(start<0||end<0)throw Error('Relabel component boundary missing');let component=workspace.slice(start,end);
component=replace(component,'[L,E]=o(""),S=t.relabelUnits??[]','[L,E]=o(""),[__labelReady,__setLabelReady]=o(false),S=t.relabelUnits??[]');
component=replace(component,'L&&e("p",{role:"alert",children:L}),r("fieldset",','L&&e("p",{role:"alert",children:L}),e(__LamodaRelabelDataForm,{requestId:t.requestId,token:a,disabled:i,onReady:__setLabelReady,onSaved:g}),r("fieldset",');
component=replace(component,'disabled:!b||!!B.printStatus&&B.printStatus!=="FAILED"','disabled:!__labelReady||!b||!!B.printStatus&&B.printStatus!=="FAILED"');
workspace=workspace.slice(0,start)+component+workspace.slice(end);
workspace='import {createLamodaRelabelDataForm as __createLamodaData} from "/assets/lamoda-relabel-data-20261125.js";let __dataForm;function __LamodaRelabelDataForm(props){return (__dataForm??=__createLamodaData(me))(props)}\n'+workspace+'\nexport{$r as LamodaFboRelabel};\n';
fs.writeFileSync(path.join(dir,'delta-v2/web/assets/lamoda-relabel-workspace-20261125.js'),workspace);
index=index.replaceAll('/assets/yandex-fby-counter-20261108.js','/assets/lamoda-relabel-workspace-20261125.js');
index=replace(index,'"imports":{','"imports":{"/assets/yandex-fby-counter-20261108.js":"/assets/lamoda-relabel-workspace-20261125.js",');
fs.writeFileSync(path.join(dir,'delta-v2/web/index.html'),index);
console.log('Prepared API11/web5 relabel-only delta.');
