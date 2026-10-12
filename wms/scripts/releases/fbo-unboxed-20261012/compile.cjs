const fs=require('fs'),cp=require('child_process'),path=require('path');
const w='D:/WMSFF/_Kof/work/ozon-customer-entry/wms',ts=require(w+'/node_modules/typescript'),r=__dirname;
const names=['modules/tsd/fbo-two-stage-policy','modules/tsd/fbo-two-stage.service','modules/client-requests/ozon-fbo-import.service'];
const opts={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true};
for(const n of names){const rel='wms/apps/api/src/'+n+'.ts',before=cp.execFileSync('git',['show','30ad12e7:'+rel],{cwd:path.dirname(w),encoding:'utf8'}),after=fs.readFileSync(w+'/apps/api/src/'+n+'.ts','utf8');for(const [kind,s]of Object.entries({before,after})){const p=r+'/'+kind+'/'+n+'.js';fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,ts.transpileModule(s,{compilerOptions:opts}).outputText);}}
const n='modules/tsd/fbo-unboxed-picking.js';fs.writeFileSync(r+'/api/'+n,ts.transpileModule(fs.readFileSync(w+'/apps/api/src/modules/tsd/fbo-unboxed-picking.ts','utf8'),{compilerOptions:opts}).outputText);
fs.writeFileSync(r+'/api-changes.json',JSON.stringify([...names.map(n=>n+'.js'),n]));
