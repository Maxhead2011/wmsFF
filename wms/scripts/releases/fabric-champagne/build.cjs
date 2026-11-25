const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const repo=path.resolve(__dirname,'../../../..'),r=path.resolve(process.argv[2]),ts=require(repo+'/wms/node_modules/typescript');
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const rel='modules/analytics/fulfillment-groups.js',source='wms/apps/api/src/modules/analytics/fulfillment-groups.ts',norm=s=>s.replace(/\r\n/g,'\n').trim();
// FIX: replace only the source-proven grouping module, preserving the rest of the running API.
assert.equal(norm(compile(cp.execFileSync('git',['show','f7e56fcf:'+source],{cwd:repo,encoding:'utf8'}))),norm(fs.readFileSync(r+'/candidate/'+rel,'utf8')));
const next=compile(fs.readFileSync(repo+'/'+source,'utf8'));fs.mkdirSync(r+'/api/modules/analytics',{recursive:true});
for(const target of ['api','candidate'])fs.writeFileSync(r+'/'+target+'/'+rel,next);
fs.mkdirSync(r+'/web',{recursive:true});fs.writeFileSync(r+'/api-changes.json',JSON.stringify([rel]));fs.writeFileSync(r+'/web-changes.json','[]');console.log('API1/web0, previous module source parity verified');
