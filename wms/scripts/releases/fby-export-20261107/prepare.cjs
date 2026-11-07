// FIX: exact method additions preserve all unrelated published code.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),previous=path.resolve(process.argv[3]);
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const parse=s=>ts.createSourceFile('runtime.js',s,99,true,ts.ScriptKind.JS);
const compile=(s,jsx=false)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:jsx?ts.ModuleKind.ESNext:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true,jsx:ts.JsxEmit.React}}).outputText;
fs.cpSync(previous+'/api-candidate',root+'/api-base',{recursive:true});
const changes=[];
for(const [file,names] of [['yandex-fby-client',['offers']],['yandex-fby.service',['actualContext','exportActual']],['yandex-fby.controller',['exportActual']]]){
 const rel='modules/yandex-fby/'+file+'.js';let live=read(root+'/api-base/'+rel),next=compile(read('apps/api/src/modules/yandex-fby/'+file+'.ts'));
 const tree=parse(next);let cls;function visit(n){if((ts.isClassDeclaration(n)||ts.isClassExpression(n)))cls=n;ts.forEachChild(n,visit)}visit(tree);assert(cls);
 const methods=cls.members.filter(n=>ts.isMethodDeclaration(n)&&names.includes(n.name.getText(tree)));assert.equal(methods.length,names.length);
 let oldClass;const oldTree=parse(live);function oldVisit(n){if((ts.isClassDeclaration(n)||ts.isClassExpression(n)))oldClass=n;ts.forEachChild(n,oldVisit)}oldVisit(oldTree);assert(oldClass);
 for(const name of names)assert(!oldClass.members.some(n=>n.name?.getText(oldTree)===name));
 live=live.slice(0,oldClass.end-1)+'\n'+methods.map(n=>n.getText(tree)).join('\n')+'\n'+live.slice(oldClass.end-1);
 if(file==='yandex-fby.service')live='const client_1 = require("@prisma/client");\nconst yandex_fby_export_1 = require("./yandex-fby-export");\n'+live;
 if(file==='yandex-fby.controller'){
  const decorators=tree.statements.filter(n=>ts.isExpressionStatement(n)&&n.getText(tree).includes('"exportActual"')).map(n=>n.getText(tree));assert.equal(decorators.length,1);
  // Route decorators can be appended after the class export; Nest reads metadata at bootstrap.
  live+='\n'+decorators[0]+'\n';
 }
 assert.equal(parse(live).parseDiagnostics.length,0);write(root+'/api-payload/'+rel,live);changes.push(rel);
}
for(const f of ['yandex-fby-export','yandex-fby-template']){const rel='modules/yandex-fby/'+f+'.js';write(root+'/api-payload/'+rel,compile(read('apps/api/src/modules/yandex-fby/'+f+'.ts')));changes.push(rel)}
const registry='modules/administration/administration-internal-api.service.js';let reg=read(root+'/api-base/'+registry);const marker=/prefixes: \['\/yandex-fby'\], routeCount: 9/g;assert.equal([...reg.matchAll(marker)].length,1);reg=reg.replace(marker,"prefixes: ['/yandex-fby'], routeCount: 10");write(root+'/api-payload/'+registry,reg);changes.push(registry);
write(root+'/api-changes.json',JSON.stringify(changes));
const oldAsset='assets/fby-status-client-controls-20261107.js',newAsset='assets/fby-export-client-controls-20261107.js';let web=read(previous+'/web-payload/'+oldAsset);
const start=web.indexOf('f.yandexFbyShipment.remoteNumber'),anchor='r("div",{className:"fby-actions",children:[';const pos=web.indexOf(anchor,start);assert(pos>start);
web=web.slice(0,pos+anchor.length)+'e(__FbyExport,{token:a,accountId:p,requestId:f.id,number:f.number,status:f.status},p+":"+f.id),'+web.slice(pos+anchor.length);
web='import {FbyActualExportButton as __FbyExport} from "./fby-actual-export-20261107.js";\n'+web;assert.equal(parse(web).parseDiagnostics.length,0);write(root+'/web-payload/'+newAsset,web);
let component=read('apps/web/src/components/yandex-fby/FbyActualExportButton.tsx').replace("import { useEffect, useRef, useState } from 'react';",'const {useEffect,useRef,useState}=React;');
write(root+'/web-payload/assets/fby-actual-export-20261107.js','import {r as React} from "./admin-tiles-20261019-0.js";\n'+compile(component,true));
let html=read(previous+'/web-payload/index.html');const match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);let replaced=0;
for(const k of Object.keys(map.imports))if(map.imports[k]==='/'+oldAsset){map.imports[k]='/'+newAsset;replaced++}assert(replaced);map.imports['/'+oldAsset]='/'+newAsset;html=html.replace(match[1],()=>JSON.stringify(map));write(root+'/web-payload/index.html',html);
write(root+'/web-changes.json',JSON.stringify(['index.html',newAsset,'assets/fby-actual-export-20261107.js']));write(root+'/overlay-proof.json',JSON.stringify({apiFiles:6,webFiles:3,onlyAddedMethods:true}));console.log('Prepared API6/web3');
