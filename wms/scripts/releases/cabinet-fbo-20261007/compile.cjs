const fs=require('fs'),cp=require('child_process'),path=require('path');
const repo=path.resolve(__dirname,'../fix-fbo-plan-timeout'),ts=require(repo+'/wms/node_modules/typescript');
const modules=['modules/stock/stock-balances.service','modules/stock/stock.controller','modules/stock/dto/cabinet-stock-export.dto','modules/administration/administration-internal-api.service','modules/client-requests/client-requests.service','modules/client-requests/client-request-xlsx.service','modules/tsd/fbo-two-stage.service'];
for(const m of modules){for(const [label,ref] of [['old','4b9598f4^'],['new','f30c239c']]){
 let source;try{source=cp.execFileSync('git',['show',ref+':wms/apps/api/src/'+m+'.ts'],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch(e){if(label==='old'&&m.endsWith('cabinet-stock-export.dto'))continue;throw e;}
 if(label==='new'&&m.endsWith('cabinet-stock-export.dto')) source=fs.readFileSync(repo+'/wms/apps/api/src/'+m+'.ts','utf8');
 const p=__dirname+'/compiled-'+label+'/'+m+'.js';fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText);
}}
fs.writeFileSync(__dirname+'/api-changes.json',JSON.stringify(modules.map(m=>m+'.js')));
