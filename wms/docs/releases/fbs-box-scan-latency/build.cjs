const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'../../../..');
const target=process.argv[2];
if(!target)throw Error('Pass the materialized runtime directory');
const ts=require(root+'/wms/node_modules/typescript');
const rel='wms/apps/api/src/modules/marketplace-connections/marketplace-connections.service.ts';
const old=cp.execFileSync('git',['show',(process.argv[3] || '9f7c8095')+':'+rel],{cwd:root,encoding:'utf8',maxBuffer:10*1024*1024});
const fresh=fs.readFileSync(root+'/'+rel,'utf8');
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
function method(s,n){const tree=ts.createSourceFile('x.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let found;function visit(node){if(ts.isMethodDeclaration(node)&&node.name?.getText(tree)===n)found={start:node.getStart(tree),end:node.end,text:node.getText(tree)};ts.forEachChild(node,visit)}visit(tree);if(!found)throw Error('missing '+n);return found;}
const file=path.join(target,'modules/marketplace-connections/marketplace-connections.service.js');
let live=fs.readFileSync(file,'utf8');const newJs=compile(fresh),oldJs=compile(old);
const normalize=s=>s.replace(/\s+/g,'');
// FIX: refuse a delta if the old switch body is not the deployed implementation.
if(normalize(method(live,'switchFbsTsdAssemblyToBox').text)!==normalize(method(oldJs,'switchFbsTsdAssemblyToBox').text))throw Error('live switch differs from Git base');
let m=method(live,'switchFbsTsdAssemblyToBox');live=live.slice(0,m.start)+method(newJs,'switchFbsTsdAssemblyToBox').text+live.slice(m.end);
// Preserve every line of deployed scanning behavior; only rename its entry point.
m=method(live,'scanFbsTsdBox');live=live.slice(0,m.start)+method(newJs,'scanFbsTsdBox').text+'\n    '+m.text.replace('scanFbsTsdBox(', 'performFbsTsdBoxScan(')+live.slice(m.end);
live='const fbs_box_scan_search_1 = require("./fbs-box-scan-search");\n'+live;
fs.writeFileSync(file,live);
fs.writeFileSync(path.dirname(file)+'/fbs-box-scan-search.js',compile(fs.readFileSync(root+'/wms/apps/api/src/modules/marketplace-connections/fbs-box-scan-search.ts','utf8')));
console.log('Two runtime files patched; original deployed scan body preserved.');

