// TEST: execute the exact shipped media component with React and synthetic API only.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/La_pa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const esbuild=require('node:module').createRequire(require.resolve('../../../apps/web/node_modules/vite'))('esbuild');
const root=path.resolve(process.argv[2]);
(async()=>{
 const read=p=>fs.readFileSync(p,'utf8'),s=read(root+'/web-payload/assets/ozon-media-core-20261108.js'),html=read(root+'/web-payload/index.html');
 const map=JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
 assert(!Object.values(map).includes('/assets/wb-all-labels-api-20261108.js'));
 assert.equal([...html.matchAll(/<script[^>]+src="\/assets\/ozon-media-core-20261108.js"/g)].length,1);assert(!html.includes('src="/assets/stock-export-20261106.js"'));
 assert(s.includes('e.jsx(__StationMedia,{session:t})'));
 const component=s.slice(s.lastIndexOf('var __StationMedia='));
 const bundle=esbuild.buildSync({stdin:{contents:'import * as x from "react";import {createRoot} from "react-dom/client";'+component+'\ncreateRoot(document.getElementById("root")).render(x.createElement(__StationMedia,{session:{accessToken:"synthetic"}}));',resolveDir:path.resolve('apps/web'),loader:'jsx'},bundle:true,write:false,format:'iife'}).outputFiles[0].text;
 const b=await chromium.launch({channel:'msedge',headless:true});let passed=0;
 try{const p=await b.newPage();let posts=[];await p.route('**/*',async route=>{const q=route.request();if(q.url().endsWith('/formats'))return route.fulfill({json:[{id:'ozon',name:'ОЗОН',printerName:'TSC TE200',labelWidthMm:58,labelHeightMm:40}]});if(q.method()==='POST'){posts.push(q.postDataJSON());return route.fulfill({json:{ok:true}})}return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'})});await p.goto('http://synthetic.test/');await p.addScriptTag({content:bundle});
 await p.getByLabel('Формат этикетки').selectOption('70x120');assert.equal(await p.getByLabel('Ширина, мм').inputValue(),'70');assert.equal(await p.getByLabel('Длина по подаче, мм').inputValue(),'120');passed++;
 await p.getByRole('button',{name:'Сохранить формат'}).click();await p.getByRole('status').filter({hasText:'Сохранено'}).waitFor();assert.deepEqual(posts,[{widthMm:70,heightMm:120}]);passed++;
 await p.getByLabel('Формат этикетки').selectOption('custom');assert.equal(await p.getByLabel('Ширина, мм').inputValue(),'70');await p.getByLabel('Ширина, мм').fill('60');await p.getByRole('button',{name:'Сохранить формат'}).click();await p.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('Сохранено'));assert.deepEqual(posts[1],{widthMm:60,heightMm:120});passed++;
 await p.screenshot({path:root+'/media-selector.png'});
 }finally{await b.close()}
 fs.writeFileSync(root+'/runtime-browser-proof.json',JSON.stringify({passed,syntheticOnly:true,singleModuleEntry:true}));console.log({passed});
})().catch(e=>{console.error(e);process.exitCode=1});
