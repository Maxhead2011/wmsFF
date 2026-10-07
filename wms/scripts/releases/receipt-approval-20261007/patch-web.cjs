const fs=require('fs'),path=require('path'),ts=require('../service-menu-tiles/wms/node_modules/typescript');
const r=__dirname,graph=JSON.parse(fs.readFileSync(r+'/web-graph.json')),files=Object.fromEntries(graph.map(n=>[n,fs.readFileSync(r+'/web-base/'+n,'utf8')])),m=JSON.parse(fs.readFileSync(r+'/receipt-function.json'));
let compiled=ts.transpileModule(fs.readFileSync(r+'/../service-menu-tiles/wms/apps/web/src/components/warehouse/ReceiptDirectionsPanel.tsx','utf8'),{compilerOptions:{target:99,module:99,jsx:ts.JsxEmit.React,jsxFactory:'e.createElement',jsxFragmentFactory:'e.Fragment'}}).outputText;
compiled=compiled.replace(/^import .*;\r?\n/gm,'').replace('export function ReceiptDirectionsPanel','function '+m.name).replace('    const [client,','    const useEffect=O,useRef=L,useState=u;\n    const [client,');
const original=fs.readFileSync(r+'/receipt-original.js','utf8');if(files[m.file].split(original).length!==2)throw Error('Function mismatch');files[m.file]=files[m.file].replace(original,compiled);
const rename=Object.fromEntries(graph.filter(n=>n.endsWith('.js')).map(n=>[path.basename(n),path.basename(n,'.js')+'-receiptapproval.js'])),changes=[];
for(const n of graph){let s=files[n];for(const [a,b]of Object.entries(rename).sort((a,b)=>b[0].length-a[0].length))s=s.split(a).join(b);const dest=n.endsWith('.js')?'assets/'+rename[path.basename(n)]:n;if(n.endsWith('.js')){const ast=ts.createSourceFile(dest,s,99,true,1);if(ast.parseDiagnostics.length)throw Error('Invalid '+dest);}
const p=r+'/candidate-web/'+dest;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);changes.push(dest);}
fs.writeFileSync(r+'/web-changes.json',JSON.stringify(changes));console.log('Isolated receipt component updated in '+changes.length+' reachable files');
