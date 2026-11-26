// FIX: one helper and an anchored patch of the current progress component only.
const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('assert/strict');
const dir=path.resolve(process.argv[2]),root=path.resolve(__dirname,'../../..');
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,a);return s.replace(a,b)};
const save=(f,s)=>{const p=path.join(dir,f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
save('api-payload/modules/tsd/fbo-box-statistics.js',ts.transpileModule(fs.readFileSync(path.join(root,'apps/api/src/modules/tsd/fbo-box-statistics.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
let s=fs.readFileSync(path.join(dir,'web-base.js'),'utf8');
s=once(s,'function Ii({plan:s,paused:t=!1,accessToken:$historyToken}){','function Ii({plan:s,paused:t=!1,accessToken:$historyToken}){const stats=s.boxStatistics,remaining=Math.max(0,s.needed-s.picked),hasPickingBreakdown=stats?.remainingPartialPickUnits!==undefined&&stats.remainingWholePickBoxes!==undefined&&stats.remainingWholePickUnits!==undefined,unassigned=hasPickingBreakdown?Math.max(0,remaining-stats.remainingPartialPickUnits-stats.remainingWholePickUnits):0;');
s=once(s,'e.jsx("strong",{children:Math.max(0,s.needed-s.picked)})]})','e.jsx("strong",{children:remaining}),hasPickingBreakdown&&e.jsxs("div",{className:"fbo-picking-breakdown",children:[e.jsx("span",{children:`Частичный отбор — ${stats.remainingPartialPickUnits} шт.`}),e.jsx("span",{children:`Целыми коробами — ${stats.remainingWholePickBoxes} кор. · ${stats.remainingWholePickUnits} шт.`}),unassigned>0&&e.jsx("span",{children:`Без маршрута отбора — ${unassigned} шт.`})]})]})');
s=once(s,'`Отобрано коробов: ${s.boxStatistics.pickedBoxes}`','`Коробов-источников использовано: ${s.boxStatistics.pickedBoxes}`');
s=once(s,'p==="Упаковка"&&s.boxStatistics?.remainingWholeBoxes!==undefined','p==="Отбор"&&stats?.pickedPartialUnits!==undefined&&stats.pickedWholeBoxes!==undefined&&stats.pickedWholeUnits!==undefined&&e.jsxs("div",{className:"fbo-picking-breakdown",children:[e.jsx("span",{children:`Частично отобрано — ${stats.pickedPartialUnits} шт.`}),e.jsx("span",{children:`Целыми коробами отобрано — ${stats.pickedWholeBoxes} кор. · ${stats.pickedWholeUnits} шт.`})]}),p==="Упаковка"&&s.boxStatistics?.remainingWholeBoxes!==undefined');
save('web-payload/assets/fbo-pick-breakdown-20261126.js',s);
let html=fs.readFileSync(path.join(dir,'index.html'),'utf8');assert(html.includes('/assets/fbs-cargo-buttons-20261125.js'));html=html.replaceAll('/assets/fbs-cargo-buttons-20261125.js','/assets/fbo-pick-breakdown-20261126.js');
html=once(html,'"imports":{','"imports":{"/assets/fbs-cargo-buttons-20261125.js":"/assets/fbo-pick-breakdown-20261126.js",');save('web-payload/index.html',html);
console.log('Prepared exact API1/web2');
