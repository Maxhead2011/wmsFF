const fs=require('fs'),ts=require('../../../node_modules/typescript'),cp=require('child_process'),assert=require('assert/strict'),path=require('path');
const r='D:/WMSFF/_Kof/work/receipt-count-release-20261101',n='modules/warehouse/receipt-channel-policy.js',file='wms/apps/api/src/modules/warehouse/receipt-channel-policy.ts';
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS};
const before=ts.transpileModule(cp.execFileSync('git',['show','origin/feature/wb-print-check:'+file],{encoding:'utf8'}),{compilerOptions:options}).outputText;
const after=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:options}).outputText;
const live=fs.readFileSync(r+'/api-live/'+n,'utf8');
const get=s=>{const ast=ts.createSourceFile('a.js',s,99,true);const f=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='receiptDocuments');assert(f);return {start:f.getStart(ast),end:f.end,text:f.getText(ast)}};
const b=get(before),a=get(after),l=get(live);fs.writeFileSync(r+'/before.txt',b.text);fs.writeFileSync(r+'/live.txt',l.text);
const marker='    // FIX: explicit membership can recover';
const start=a.text.indexOf(marker),end=a.text.indexOf('    return [...groups.values()]',start);
assert(start>=0&&end>start);
const anchor='    return [...groups.values()]';assert.equal(l.text.split(anchor).length,2);
const replacement=l.text.replace(anchor,a.text.slice(start,end)+anchor);
const out=live.slice(0,l.start)+replacement+live.slice(l.end);
assert.equal(ts.createSourceFile('a.js',out,99,true).parseDiagnostics.length,0);
fs.mkdirSync(path.dirname(r+'/api-payload/'+n),{recursive:true});fs.writeFileSync(r+'/api-payload/'+n,out);
console.log('Prepared exact receiptDocuments overlay');

