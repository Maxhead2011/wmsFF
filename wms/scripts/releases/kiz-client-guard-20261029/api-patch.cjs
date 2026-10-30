// FIX: reproduce a bounded overlay from the verified live baseline, never a full source rebuild.
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('node:assert/strict');
const ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),python=process.argv[3],repo=path.resolve(__dirname,'../../../..');
assert(root.includes('kiz-guard-build')&&fs.existsSync(root+'/base-api/main.js')&&python);
for(const relative of ['candidate-current','api/payload']){
 const target=path.resolve(root,relative);assert(target.startsWith(root+path.sep));
 if(fs.existsSync(target))fs.rmSync(target,{recursive:true});fs.mkdirSync(target,{recursive:true});
}
fs.cpSync(root+'/base-api',root+'/candidate-current',{recursive:true});
const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true};
for(const name of ['kiz-client-registry','kiz-client-review']){
 const source=fs.readFileSync(repo+'/wms/apps/api/src/common/'+name+'.ts','utf8');
 const dest=root+'/api/payload/common/'+name+'.js';fs.mkdirSync(path.dirname(dest),{recursive:true});
 fs.writeFileSync(dest,ts.transpileModule(source,{compilerOptions:options}).outputText);
}
cp.execFileSync(python,[__dirname+'/reuse-patch.py',root],{stdio:'inherit'});
cp.execFileSync(python,[__dirname+'/receipt-patch.py','--base',root+'/base-api','--out',root+'/api/payload'],{stdio:'inherit'});
for(const script of ['transport-patch.cjs','shipment-patch.cjs'])cp.execFileSync(process.execPath,[__dirname+'/'+script,root],{stdio:'inherit'});
fs.cpSync(root+'/api/payload',root+'/candidate-current',{recursive:true});
console.log('API candidate:',root+'/candidate-current');
