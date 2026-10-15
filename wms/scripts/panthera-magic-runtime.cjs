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
const sf=ts.createSourceFile(entry,s,99,true),edits=[],counts={switcher:0,restore:0,fallback:0,auth:0};
const replace=(source,from,to)=>{assert.equal(source.split(from).length,2,'Binding drift: '+from);return source.replace(from,to);};
for(const node of sf.statements){
 if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(sf)==='__ThemeStyleSwitcher')){
  edits.push({start:node.getStart(sf),end:node.end,code:bundle+'const __ThemeStyleSwitcher=__Magic.ThemeStyleSwitcher;'});counts.switcher++;
 }
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='Q5'){
  let body=node.getText(sf);
  body=replace(body,'e.jsx(__ThemeStyleSwitcher,{userId:t.user.id},t.user.id)','e.jsx(__ThemeStyleSwitcher,{userId:t.user.id,workspaceId:se.id},t.user.id)');
  const restore=node.body.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(sf)==='s'&&n.thenStatement.getText(sf).includes('auth-shell'));
  assert(restore&&ts.isReturnStatement(restore.thenStatement));const old=restore.getText(sf),value=restore.thenStatement.expression.getText(sf);
  body=replace(body,old,'if(s)return t&&m==="la_panthera"&&__Magic.magicEnabled(window.location.hostname)&&__Magic.welcomeStyle(t.user)?e.jsx("main",{className:"auth-shell",children:e.jsx(__Magic.MagicWelcome,{user:t.user})}):'+value+';');counts.restore++;
  edits.push({start:node.getStart(sf),end:node.end,code:body});
 }
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='J5'){
  function visit(n){if(ts.isPropertyAssignment(n)&&n.name.getText(sf)==='fallback'){
   edits.push({start:n.initializer.getStart(sf),end:n.initializer.end,code:'i==="la_panthera"&&__Magic.magicEnabled(window.location.hostname)&&__Magic.welcomeStyle(n.user)?e.jsx(__Magic.MagicWelcome,{user:n.user}):'+n.initializer.getText(sf)});counts.fallback++;return;
  }ts.forEachChild(n,visit);}visit(node);
 }
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='yO'){
  const body=replace(node.getText(sf),'s==="login"&&xO(N.user.id,window.location.hostname)?R(N):t(N)','s==="login"&&Tj(N.user)!=="la_panthera"&&xO(N.user.id,window.location.hostname)?R(N):t(N)');
  edits.push({start:node.getStart(sf),end:node.end,code:body});counts.auth++;
 }
}
assert.deepEqual({...counts,fallback:0},{switcher:1,restore:1,fallback:0,auth:1});assert.equal(counts.fallback,16);
for(const e of edits.sort((a,b)=>b.start-a.start))s=s.slice(0,e.start)+e.code+s.slice(e.end);
cache['assets/'+entry]=s;
const result=repair(files,entry,entry,'panthera-magic-20261014');
result['index.html']=result['index.html'].replace('</head>','<link rel="stylesheet" href="/assets/panthera-magic-20261014.css"></head>');
result['assets/panthera-magic-20261014.css']=fs.readFileSync(path.join(w,'apps/web/src/components/layout/magic-appearance.css'),'utf8');
const assets=path.join(w,'apps/web/public/themes/magic');
function copy(dir,rel=''){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const n=path.posix.join(rel,ent.name),p=path.join(dir,ent.name);if(ent.isDirectory())copy(p,n);else result['themes/magic/'+n]=fs.readFileSync(p);}}copy(assets);
for(const [n,data] of Object.entries(result)){if(n.endsWith('.js'))assert.equal(ts.createSourceFile(n,data,99,true).parseDiagnostics.length,0,n);const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));console.log(JSON.stringify({...counts,files:Object.keys(result).length}));

