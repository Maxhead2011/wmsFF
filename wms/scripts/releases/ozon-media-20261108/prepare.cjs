// FIX: add media settings to exact published modules; retain all unrelated bytes.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),compiled=path.resolve(process.argv[3]);
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const changes=[];
function patch(file,pairs){let s=read(root+'/api-base/'+file),base=s;for(const[a,b]of pairs){assert.equal(s.split(a).length,2,a);s=s.replace(a,b)}let inverse=s;for(const[a,b]of [...pairs].reverse())inverse=inverse.replace(b,a);assert.equal(inverse,base);write(root+'/api-payload/'+file,s);changes.push(file)}
function members(s,names){const ast=ts.createSourceFile('a.js',s,99,true);let found=[];function walk(n){if(ts.isMethodDeclaration(n)&&names.includes(n.name.getText(ast)))found.push(n.getText(ast));ts.forEachChild(n,walk)}walk(ast);assert.equal(found.length,names.length);return found.join('\n    ')}
const service=read(compiled+'/modules/print/print-series.service.js');
patch('modules/print/print-series.service.js',[['    async create(body, user) {','    '+members(service,['formats','setFormat'])+'\n    async create(body, user) {']]);
const ctrl=read(compiled+'/modules/print/print-series.controller.js'),decorators=ctrl.match(/__decorate\(\[\n    \(0, common_1.Get\)\('formats'\)[\s\S]*?PrintSeriesController.prototype, "format", null\);/)[0];
patch('modules/print/print-series.controller.js',[
 ['    stations(u) {','    '+members(ctrl,['formats','format'])+'\n    stations(u) {'],
 ['exports.PrintSeriesController = PrintSeriesController;','exports.PrintSeriesController = PrintSeriesController;\n'+decorators]
]);
const reg='modules/administration/administration-internal-api.service.js',s=read(root+'/api-base/'+reg),m=s.match(/id: 'print',[\s\S]{0,400}?routeCount: 36/);assert(m);patch(reg,[[m[0],m[0].replace('routeCount: 36','routeCount: 38')]]);
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});write(root+'/api-changes.json',JSON.stringify(changes));
const old='/assets/wb-all-labels-api-20261108.js',next='/assets/ozon-media-core-20261108.js';let web=read(root+'/web-base'+old),base=web;
const ast=ts.createSourceFile('web.js',web,99,true),panel=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='Q6');assert(panel);
const panelText=panel.getText(ast),anchor='className:"print-printer-layout",children:[';assert.equal(panelText.split(anchor).length,2);
const newPanel=panelText.replace(anchor,anchor+'e.jsx(__StationMedia,{session:t}),');web=web.replace(panelText,newPanel);assert.equal(web.replace(newPanel,panelText),base);
let source=read('apps/web/src/components/print/PrintStationFormatPanel.tsx').replace(/^import .*?;\r?\n/gm,'').replace(/export /g,'').replace("import.meta.env.VITE_API_URL ?? '/api/v1'","'/api/v1'");
let component=ts.transpileModule(source,{compilerOptions:{target:99,module:99,jsx:ts.JsxEmit.React,jsxFactory:'x.createElement'}}).outputText;
web+='\nvar __StationMedia=(()=>{const {useState,useEffect}=x;\n'+component+'\nreturn PrintStationFormatPanel;})();\n';
assert.equal(ts.createSourceFile('web.js',web,99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);write(root+'/web-payload'+next,web);
let html=read(root+'/web-base/index.html'),match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);let count=0;for(const key of Object.keys(map.imports))if(map.imports[key]===old){map.imports[key]=next;count++}assert(count);map.imports[old]=next;html=html.replace(match[1],()=>JSON.stringify(map));assert.equal(html.split('src="/assets/stock-export-20261106.js"').length,2);html=html.replace('src="/assets/stock-export-20261106.js"','src="'+next+'"');write(root+'/web-payload/index.html',html);
write(root+'/web-changes.json',JSON.stringify(['index.html',next.slice(1)]));write(root+'/overlay-proof.json',JSON.stringify({apiFiles:3,webFiles:2,existingBytesPreserved:true}));console.log('API3/web2 exact additions prepared');
