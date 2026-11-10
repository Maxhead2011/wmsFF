// FIX: accept a runtime module only when all baseline tokens match the source base.
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const repo=process.cwd(),ts=require(path.join(repo,'wms/node_modules/typescript'));
const root=process.argv[2];assert(root);
const files=['modules/client-requests/request-market-status.service','modules/client-requests/request-market-status-scheduler.service',
 'modules/marketplace-connections/wb-packed-auto-done','modules/marketplace-connections/ozon-packed-auto-done'];
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:1,target:9,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
const tokens=s=>{const scanner=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,s),result=[];let k;while((k=scanner.scan())!==ts.SyntaxKind.EndOfFileToken)result.push(scanner.getTokenText());return result;};
for(const f of files){
 const src='wms/apps/api/src/'+f+'.ts',dest=path.join(root,f+'.js');
 const old=compile(cp.execFileSync('git',['show','ab4f0622:'+src],{encoding:'utf8'}));
 assert.deepEqual(tokens(fs.readFileSync(dest,'utf8')),tokens(old),'runtime drift: '+f);
 fs.writeFileSync(dest,compile(fs.readFileSync(src,'utf8')));
}
console.log('PASS: four runtime modules match baseline source; only approved modules replaced');
