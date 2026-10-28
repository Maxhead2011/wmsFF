// FIX: exact API deltas over the verified runtime; never replace the full API build.
const fs=require('fs'),path=require('path'),cp=require('child_process'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),repo=path.resolve(__dirname,'../../../..'),base=process.argv[3]||'5c771bf1';
const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true};
const compiled={};
for(const name of ['modules/skus/skus.service','modules/skus/skus.controller','modules/print/lamoda-print-barcodes']){
 const file='wms/apps/api/src/'+name+'.ts';let old=null;
 if(!name.endsWith('lamoda-print-barcodes'))old=cp.execFileSync('git',['show',base+':'+file],{cwd:repo,encoding:'utf8'});
 const compile=s=>ts.transpileModule(s,{compilerOptions:options}).outputText;
 compiled[name+'.js']={old:old===null?null:compile(old),next:compile(fs.readFileSync(repo+'/'+file,'utf8'))};
}
fs.writeFileSync(root+'/compiled.json',JSON.stringify(compiled));
cp.execFileSync('python',[path.join(__dirname,'patch.py'),root],{stdio:'inherit'});
