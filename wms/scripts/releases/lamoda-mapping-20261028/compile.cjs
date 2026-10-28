// FIX: compile only declared deltas against the current integration base.
const fs=require('fs'),path=require('path'),cp=require('child_process'),ts=require('../../../node_modules/typescript');
const repo=path.resolve(__dirname,'../../../..'),root=process.argv[2];
const names=cp.execFileSync('git',['diff','--name-only','origin/feature/wb-print-check','--','wms/apps/api/src'],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true};
const result={};for(const n of names){let old=null;try{old=cp.execFileSync('git',['show','origin/feature/wb-print-check:'+n],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{}
result[n.replace('wms/apps/api/src/','').replace(/\.ts$/,'.js')]={old:old===null?null:ts.transpileModule(old,{compilerOptions:options}).outputText,next:ts.transpileModule(fs.readFileSync(repo+'/'+n,'utf8'),{compilerOptions:options}).outputText};}
fs.writeFileSync(root+'/compiled.json',JSON.stringify(result));
