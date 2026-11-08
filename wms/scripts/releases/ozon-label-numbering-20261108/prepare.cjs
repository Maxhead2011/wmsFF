// FIX: replace only the paired-label helper in the verified full runtime.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),name='modules/marketplace-connections/fbs-paired-labels.js';
const source=fs.readFileSync('apps/api/src/modules/marketplace-connections/fbs-paired-labels.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
assert.equal(ts.createSourceFile(name,compiled,99,true).parseDiagnostics.length,0);
fs.mkdirSync(path.dirname(root+'/api-payload/'+name),{recursive:true});fs.writeFileSync(root+'/api-payload/'+name,compiled);
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});
fs.writeFileSync(root+'/api-changes.json',JSON.stringify([name]));
fs.writeFileSync(root+'/overlay-proof.json',JSON.stringify({changed:[name],serviceUnchanged:true}));
console.log('Prepared one-file overlay');
