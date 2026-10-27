// FIX: preserve the actual live runtime; change only the label-download entry point.
const fs=require('fs'),ts=require('../../../node_modules/typescript'),assert=require('assert/strict');
const root=process.argv[2],src='wms/apps/api/src/modules/marketplace-connections/';
const options={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true};
const n='marketplace-connections.service',p=root+'/modules/marketplace-connections/'+n+'.js';
const old=fs.readFileSync(p,'utf8'),compiled=ts.transpileModule(fs.readFileSync(src+n+'.ts','utf8'),{compilerOptions:options}).outputText;
function method(s){const a=ts.createSourceFile('x.js',s,99,true);let found;function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(a)==='getFbsOrderStickersPdf')found=n;ts.forEachChild(n,visit)}visit(a);assert(found);return{start:found.getStart(a),end:found.end,text:found.getText(a)}}
const a=method(old),b=method(compiled);
// TEST: the only method delta is the explicitly added fast-path block.
const strip=s=>s.replace(/\s*\/\/ FIX: an Ozon label download[\s\S]*?const \{ orders \}/,'\n        const { orders }').replace(/\s/g,'');assert.equal(strip(a.text),strip(b.text));
fs.writeFileSync(p,'const ozon_direct_label_1=require("./ozon-direct-label");\n'+old.slice(0,a.start)+b.text+old.slice(a.end));
fs.writeFileSync(root+'/modules/marketplace-connections/ozon-direct-label.js',ts.transpileModule(fs.readFileSync(src+'ozon-direct-label.ts','utf8'),{compilerOptions:options}).outputText);
console.log('Exact download method delta; all other runtime methods preserved');
