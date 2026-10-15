
const fs=require('fs'),ts=require('../../../node_modules/typescript'),path=require('path'),assert=require('assert');
const root=process.argv[2],file='modules/client-requests/ozon-assembly-supply.service.js';
const source=fs.readFileSync(path.resolve(__dirname,'../../../apps/api/src/'+file.replace('.js','.ts')),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
function methods(s){const sf=ts.createSourceFile('x.js',s,99,true),out={};function visit(n){if(ts.isMethodDeclaration(n)&&['upload','status'].includes(n.name.getText(sf)))out[n.name.getText(sf)]={start:n.getStart(sf),end:n.end,text:n.getText(sf)};ts.forEachChild(n,visit)}visit(sf);return out}
let old=fs.readFileSync(root+'/before.js','utf8');const a=methods(old),b=methods(compiled);
for(const name of ['status','upload']){assert(a[name]&&b[name]);old=old.slice(0,a[name].start)+b[name].text+old.slice(a[name].end);}
fs.mkdirSync(root+'/api/'+path.dirname(file),{recursive:true});fs.writeFileSync(root+'/api/'+file,old);fs.writeFileSync(root+'/api-changes.json',JSON.stringify([file]));fs.writeFileSync(root+'/web-changes.json','[]');
