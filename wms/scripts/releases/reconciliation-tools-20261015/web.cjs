const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('../../single-react-graph.cjs');const root=process.argv[2],input=path.join(root,'web-base'),output=path.join(root,'web'),cache={};
const files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
const source=fs.readFileSync(path.resolve(__dirname,'../../../apps/web/src/components/client-requests/OperationsTools.tsx'),'utf8');
const ast=ts.createSourceFile('tools.tsx',source,99,true,ts.ScriptKind.TSX);const code=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n');
const bundle=esbuild.buildSync({stdin:{contents:'const React=o;const {useState,useRef,useEffect}=o;'+code,loader:'tsx'},define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api/v1')},bundle:true,write:false,format:'iife',globalName:'__OperationsTools',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
let count=0;
for(const n of fs.readdirSync(path.join(input,'assets')).filter(n=>n.endsWith('.js'))){let s=files['assets/'+n];const marker='className:"client-requests-panel"';if(!s.includes(marker))continue;
 assert(s.includes('function xr({fboOnly:s=!1,session:t,')&&s.includes('async function An(n){oe({request:n,plan:null,status:"loading"})')&&s.includes('b=ys(t.user,"stock:write")'),'Live bindings changed');
 const i=s.indexOf(marker),at=s.indexOf('children:[',i)+'children:['.length;assert(at>i&&at-i<150);s=s.slice(0,at)+'e.jsx(__OperationsTools.OperationsTools,{token:t.accessToken,userId:t.user.id,permissions:t.user.permissionCodes,onOpen:b?An:void 0}),'+s.slice(at);cache['assets/'+n]=bundle+'\n'+s;count++;
}
assert.equal(count,1);const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];const result=repair(files,entry,entry,'operations-tools-20261015');
for(const[n,s]of Object.entries(result)){if(n.endsWith('.js'))assert.equal(ts.createSourceFile(n,s,99,true).parseDiagnostics.length,0,n);const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));console.log(JSON.stringify({count,files:Object.keys(result).length}));
