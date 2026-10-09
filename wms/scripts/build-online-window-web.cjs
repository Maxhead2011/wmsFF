// FIX: patch the exact deployed graph without replacing runtime-only FBO controls.
const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');
function build(input,output){
 const cache={},files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
 const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];
 function replace(s,a,b){if(s.split(a).length!==2)throw Error('unique anchor '+a.slice(0,100));return s.replace(a,b);}
 let main=files['assets/'+entry];main=replace(main,'z(`/tsd/requests/${n}`,{accessToken:t})','z(`/tsd/requests/${n}?view=summary`,{accessToken:t})');main=replace(main,'z(`/tsd/requests/${n}/fbo`,{accessToken:t})','z(`/tsd/requests/${n}/fbo?view=summary`,{accessToken:t})');
 main+='\nexport function __onlineHistory(t,id,offset){return z(`/tsd/requests/${id}/fbo?view=history&offset=${offset}`,{accessToken:t});}\n';cache['assets/'+entry]=main;
 const chunk='assets/menu-reads-20261009-29.js';let s=files[chunk];if(!s)throw Error('pinned request chunk absent');
 const ast=ts.createSourceFile('runtime.js',s,ts.ScriptTarget.Latest,true);const progress=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Ii');let history;
 function visit(n){if(ts.isCallExpression(n)&&n.arguments[0]?.text==='details'&&n.getText(ast).includes('fbo-progress-history'))history=n.getText(ast);ts.forEachChild(n,visit);}visit(progress);if(!history)throw Error('history anchor');
 s=replace(s,history,'e.jsx(__OnlineWindow.FboHistory,{plan:s,accessToken:$historyToken})');
 s=replace(s,'function Ii({plan:s,paused:t=!1})','function Ii({plan:s,paused:t=!1,accessToken:$historyToken})');
 s=replace(s,'e.jsx(Ii,{plan:a,paused:K||!!C})','e.jsx(Ii,{plan:a,paused:K||!!C,accessToken:t})');
 s=replace(s,'const[$windowReading,$setWindowReading]=o.useState(false);','const $onlinePanel=o.useRef(null);const[$windowReading,$setWindowReading]=o.useState(false);');
 s=replace(s,'Ci(()=>de.current(),()=>document.visibilityState==="visible")','__OnlineWindow.startVisiblePolling(()=>de.current(),()=>$onlinePanel.current)');
 s=replace(s,'className:"online-execution-modal",role:"dialog","aria-modal":"true","aria-label":"Двухэтапная сборка ФБО"','ref:$onlinePanel,className:"online-execution-modal",role:"dialog","aria-modal":"true","aria-label":"Двухэтапная сборка ФБО"');
 s=replace(s,'}){var _t,Bt;const a=ys(t.user,"client-requests:read")','}){var _t,Bt;const $onlineRoot=o.useRef(null);const a=ys(t.user,"client-requests:read")');
 s=replace(s,'I=window.setInterval(()=>{f()},5e3);return()=>{l=!0,window.clearInterval(I)}','I=__OnlineWindow.startVisiblePolling(()=>f(),()=>$onlineRoot.current?.querySelector(".online-execution-modal"));return()=>{l=!0,I()}');
 s=replace(s,'className:"client-requests-panel","aria-label":"Клиентские заявки"','ref:$onlineRoot,className:"client-requests-panel","aria-label":"Клиентские заявки"');
 const historySource=fs.readFileSync(path.join(__dirname,'../apps/web/src/components/client-requests/FboHistory.tsx'),'utf8').replace(/^import .*;\r?\n/gm,'');
 const polling=fs.readFileSync(path.join(__dirname,'../apps/web/src/lib/visiblePolling.ts'),'utf8');
 s+='\nimport {__onlineHistory as fetchFboHistory} from "./'+entry+'";\n'+esbuild.buildSync({stdin:{contents:'const React=o;const {useEffect,useState}=o;\n'+historySource+'\n'+polling,loader:'tsx'},define:{'import.meta.env.VITE_MENU_READS_ENABLED':'"true"'},bundle:true,write:false,format:'iife',globalName:'__OnlineWindow',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
 cache[chunk]=s;
 const result=repair(files,entry,entry,'online-window-20261009');for(const[n,data]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}return Object.keys(result);
}
module.exports={build};if(require.main===module)console.log(JSON.stringify(build(...process.argv.slice(2))));
