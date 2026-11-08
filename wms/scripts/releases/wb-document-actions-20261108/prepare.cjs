// FIX: remove obsolete document buttons only; preserve the published print handler.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),old='assets/wb-ribbon-print-fbs-20261108.js',next='assets/wb-document-actions-20261108.js';
let base=fs.readFileSync(root+'/web-base/'+old,'utf8'),s=base;
const tree=ts.createSourceFile('fbs.js',s,99,true),cuts=[];
function visit(n){if(ts.isCallExpression(n)&&n.arguments[0]?.getText(tree)==='"button"'){const x=n.getText(tree);if(!x.includes('VNUKOVO_SORTING_CENTER')&&/ШК для ПВЗ|ШК для СЦ|QR грузомест|QR поставки/.test(x))cuts.push(x)}ts.forEachChild(n,visit)}visit(tree);assert.equal(cuts.length,6);
const pairs=[];function patch(a,b){assert.equal(s.split(a).length,2);s=s.replace(a,b);pairs.push([a,b])}
for(const[i,x]of cuts.entries())patch(x,'/* removed document '+i+' */null');
assert.equal(s.split('Печатать все ШК').length,4);s=s.replaceAll('Печатать все ШК','Печать всех ШК');
patch('"Все ШК"','/* document title */"Скачать все ШК"');patch('" ШК заказов"','" Скачать ШК"');
let reverse=s;for(const[a,b]of [...pairs].reverse())reverse=reverse.replace(b,a);reverse=reverse.replaceAll('Печать всех ШК','Печатать все ШК');assert.equal(reverse,base);
assert.equal(ts.createSourceFile('fbs.js',s,99,true).parseDiagnostics.length,0);
fs.mkdirSync(root+'/web-payload/assets',{recursive:true});fs.writeFileSync(root+'/web-payload/'+next,s);
let html=fs.readFileSync(root+'/web-base/index.html','utf8'),m=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(m[1]),count=0;
for(const k of Object.keys(map.imports))if(map.imports[k]==='/'+old){map.imports[k]='/'+next;count++}assert(count);map.imports['/'+old]='/'+next;
html=html.replace(m[1],()=>JSON.stringify(map));fs.writeFileSync(root+'/web-payload/index.html',html);
fs.writeFileSync(root+'/web-changes.json',JSON.stringify([next,'index.html']));fs.writeFileSync(root+'/overlay-proof.json',JSON.stringify({webFiles:2,removed:6,existingBytesPreserved:true}));console.log('Web2 prepared; API and print dialog unchanged');
