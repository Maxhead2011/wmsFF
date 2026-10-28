// FIX: exact deltas over the fresh published runtime; no full dist replacement.
const fs=require('fs'),path=require('path'),cp=require('child_process'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),repo=path.resolve(__dirname,'../../../..');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
const modules=['fbs-monitor-product-identity','wb-terminal-auto-reservations','fbs-stock-monitoring.service'];const data={};
for(const name of modules){const file='wms/apps/api/src/modules/marketplace-connections/'+name+'.ts';data[name]={next:compile(fs.readFileSync(repo+'/'+file,'utf8')),old:name.endsWith('.service')?compile(cp.execFileSync('git',['show','5e1e4f3f:'+file],{cwd:repo,encoding:'utf8'})):null};}
fs.writeFileSync(root+'/compiled.json',JSON.stringify(data));
cp.execFileSync(process.env.WMS_PYTHON||'python',[path.join(__dirname,'patch.py'),root],{stdio:'inherit'});
