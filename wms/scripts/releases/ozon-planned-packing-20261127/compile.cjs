const fs=require('fs'),path=require('path'),cp=require('child_process');
const ts=require(path.resolve(__dirname,'../../../apps/api/node_modules/typescript'));
const root='D:/WMSFF/_Kof',repo=root+'/work/fulfillment-analytics',r=root+'/work/ozon-planned-packing';
const files=["wms/apps/api/src/modules/administration/administration-internal-api.service.ts", "wms/apps/api/src/modules/client-requests/ozon-assembly-supply.controller.ts", "wms/apps/api/src/modules/client-requests/ozon-assembly-supply.service.ts", "wms/apps/api/src/modules/client-requests/ozon-supply-policy.ts", "wms/apps/api/src/modules/tsd/dto/fbo-action.dto.ts", "wms/apps/api/src/modules/tsd/fbo-two-stage.controller.ts", "wms/apps/api/src/modules/tsd/fbo-two-stage.service.ts", "wms/apps/api/src/modules/tsd/ozon-packing-suggestion.ts", "wms/apps/api/src/modules/client-requests/ozon-packing-plan.ts"];
for(const f of files){
 const out=f.replace('wms/apps/api/src/','').replace(/\.ts$/,'.js');
 for(const version of ['old','new']){let source;try{source=version==='old'?cp.execFileSync('git',['show','0f0927705cc0a62c6cb35b8d32de0df0f5c867b9:'+f],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}):fs.readFileSync(repo+'/'+f,'utf8');}catch(e){if(version==='old')continue;throw e;}
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
 fs.mkdirSync(path.dirname(r+'/'+version+'/'+out),{recursive:true});fs.writeFileSync(r+'/'+version+'/'+out,js);
 }
}
fs.writeFileSync(r+'/api-changes.json',JSON.stringify(files.map(f=>f.replace('wms/apps/api/src/','').replace(/\.ts$/,'.js'))));
