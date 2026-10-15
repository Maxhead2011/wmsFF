const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');
const root=process.argv[2],w=path.resolve(__dirname,'..'),input=path.join(root,'web-base'),output=path.join(root,'web'),cache={};
const files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];let s=files['assets/'+entry];
const read=n=>{const source=fs.readFileSync(path.join(w,'apps/web/src/components/layout',n),'utf8'),sf=ts.createSourceFile(n,source,99,true,ts.ScriptKind.TSX);return sf.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(sf)).join('\n');};
// FIX: compile only appearance components; retain the live React and ReactDOM owners.
const code='const React=x; const {useState,useEffect,useRef}=x;const createPortal=j5.createPortal;\n'+['themeStyle.ts','magicAppearanceState.ts','MagicAppearance.tsx','MagicWelcome.tsx','ThemeStyleSwitcher.tsx'].map(read).join('\n');
const bundle=esbuild.buildSync({stdin:{contents:code,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__Magic',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
const sf=ts.createSourceFile(entry,s,99,true),edits=[],counts={bundle:0,auth:0};
const replace=(source,from,to)=>{assert.equal(source.split(from).length,2,'Binding drift: '+from);return source.replace(from,to);};
for(const node of sf.statements){
 if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(sf)==='__Magic')){
  assert.equal(node.declarationList.declarations.length,1);
  edits.push({start:node.getStart(sf),end:node.end,code:bundle});counts.bundle++;
 }
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='yO'){
  let body=replace(node.getText(sf),'s==="login"&&Tj(N.user)!=="la_panthera"&&xO(N.user.id,window.location.hostname)?R(N):t(N)',
   's==="login"&&((__Magic.magicEnabled(window.location.hostname)&&__Magic.welcomeStyle(N.user))||(Tj(N.user)!=="la_panthera"&&xO(N.user.id,window.location.hostname)))?R(N):t(N)');
  body=replace(body,'return k?e.jsx(vO,{onComplete:()=>t(k)}):','return k?(__Magic.magicEnabled(window.location.hostname)&&__Magic.welcomeStyle(k.user)?e.jsx("main",{className:"auth-shell",children:e.jsx(__Magic.MagicWelcome,{user:k.user,onComplete:()=>t(k)})}):e.jsx(vO,{onComplete:()=>t(k)})):');
  edits.push({start:node.getStart(sf),end:node.end,code:body});counts.auth++;
 }
}
assert.deepEqual(counts,{bundle:1,auth:1});
for(const e of edits.sort((a,b)=>b.start-a.start))s=s.slice(0,e.start)+e.code+s.slice(e.end);
cache['assets/'+entry]=s;
const result=repair(files,entry,entry,'personal-login-20261014');
for(const [n,data] of Object.entries(result)){if(n.endsWith('.js'))assert.equal(ts.createSourceFile(n,data,99,true).parseDiagnostics.length,0,n);const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));console.log(JSON.stringify({...counts,files:Object.keys(result).length}));

