const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process'),ts=require('../../../node_modules/typescript');
const root=process.argv[2],repo=path.resolve(__dirname,'../../../..'),files=['operation-timing','operation-histogram'];
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
const normalize=s=>ts.createPrinter({removeComments:true}).printFile(ts.createSourceFile('module.js',s,99,true));
const old=cp.execFileSync('git',['show','HEAD:wms/apps/api/src/common/diagnostics/operation-timing.ts'],{cwd:repo,encoding:'utf8'});
assert.equal(normalize(compile(old)),normalize(fs.readFileSync(path.join(root,'api/common/diagnostics/operation-timing.js'),'utf8')),'Live source parity changed');
for(const name of files){const source=fs.readFileSync(path.resolve(__dirname,'../../../apps/api/src/common/diagnostics/'+name+'.ts'),'utf8');fs.writeFileSync(path.join(root,'api/common/diagnostics/'+name+'.js'),compile(source));}
fs.writeFileSync(path.join(root,'api-changes.json'),JSON.stringify(files.map(n=>'common/diagnostics/'+n+'.js')));console.log('Two diagnostic modules only; source parity verified');
