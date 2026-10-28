// FIX: compile only declared Lamoda deltas, then apply unique hunks over verified runtime.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const ts=require('../../../node_modules/typescript');
const candidate=process.argv[2];assert(candidate);
const repo=path.resolve(__dirname,'../../../..'),base=process.argv[3]||'232d1021';
const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true};
const compiled={};
for(const name of ['lamoda.service','lamoda.controller','lamoda.dto','lamoda-stock-guard']){
 const source='wms/apps/api/src/modules/lamoda/'+name+'.ts';let old=null;
 if(name!=='lamoda-stock-guard')old=cp.execFileSync('git',['show',base+':'+source],{cwd:repo,encoding:'utf8'});
 const compile=s=>ts.transpileModule(s,{compilerOptions:options}).outputText;
 compiled['modules/lamoda/'+name+'.js']={old:old===null?null:compile(old),next:compile(fs.readFileSync(path.join(repo,source),'utf8'))};
}
const file=path.resolve(candidate,'../compiled.json');fs.writeFileSync(file,JSON.stringify(compiled));
cp.execFileSync('python',[path.join(__dirname,'patch.py'),candidate,file],{stdio:'inherit'});
