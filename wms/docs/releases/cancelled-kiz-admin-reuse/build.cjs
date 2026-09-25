// FIX: compile only the reviewed modules into a separately materialized production baseline.
const fs=require('node:fs'),path=require('node:path');
const [typescriptPath,candidate]=process.argv.slice(2);
if(!typescriptPath||!candidate)throw Error('Usage: node build.cjs <typescript module path> <materialized candidate>');
const ts=require(path.resolve(typescriptPath));
for(const name of ['kiz-wb-reuse','kiz-review-queue','kiz-cancelled-reuse']){
 const source=fs.readFileSync(path.join(__dirname,'source',name+'.ts'),'utf8');
 const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true},reportDiagnostics:true});
 if(result.diagnostics?.length)throw Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));
 fs.writeFileSync(path.join(candidate,'common',name+'.js'),result.outputText);
}
