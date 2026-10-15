const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), assert = require('node:assert/strict');
const ts = require('../../../node_modules/typescript');
const root = path.resolve(__dirname, '../../../..'), target = process.argv[2];
assert(target, 'Pass materialized candidate path');
const modules = ['main', 'modules/tsd/tsd-operation-log.service'];
const compile = text => ts.transpileModule(text, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const normalize = text => ts.createPrinter({removeComments:true}).printFile(ts.createSourceFile('module.js',text,ts.ScriptTarget.ES2022,true));
function classNode(text) { const sf=ts.createSourceFile('module.js',text,ts.ScriptTarget.ES2022,true); let found; function visit(n){if(ts.isClassExpression(n))found=n;ts.forEachChild(n,visit);}visit(sf);assert(found);return {sf,node:found}; }
function method(text,name) {const {sf,node}=classNode(text),found=node.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(sf)===name);assert(found);return {start:found.getStart(sf),end:found.end,text:found.getText(sf)};}
// FIX: verify full pre-change module parity before replacing any runtime file.
for (const name of modules) {
  const source = 'wms/apps/api/src/' + name + '.ts';
  const before = cp.execFileSync('git',['show','origin/feature/wb-print-check:'+source],{cwd:root,encoding:'utf8'});
  const current = fs.readFileSync(path.join(target,name+'.js'),'utf8');
  if(name==='main') assert.equal(normalize(compile(before)),normalize(current),'Source/runtime mismatch: '+name);
  else {
    // Preserve deployed decorator metadata; isolated transpilation emits a different DI wrapper.
    const a=classNode(compile(before)),b=classNode(current);
    const printer=ts.createPrinter({removeComments:true});
    assert.equal(printer.printNode(ts.EmitHint.Unspecified,a.node,a.sf),printer.printNode(ts.EmitHint.Unspecified,b.node,b.sf),'Source/runtime class mismatch: '+name);
  }
}
const names = [...modules,'common/diagnostics/operation-timing'];
for (const name of names) {
  const output = path.join(target,name+'.js'); fs.mkdirSync(path.dirname(output),{recursive:true});
  const compiled=compile(fs.readFileSync(path.join(root,'wms/apps/api/src',name+'.ts'),'utf8'));
  if(name==='modules/tsd/tsd-operation-log.service') {
    const old=fs.readFileSync(output,'utf8'),a=method(old,'findExisting'),b=method(compiled,'findExisting');
    fs.writeFileSync(output,old.slice(0,a.start)+b.text+old.slice(a.end));
  } else fs.writeFileSync(output,compiled);
}
console.log(JSON.stringify({parityVerified:modules,changed:names.map(n=>n+'.js')}));
