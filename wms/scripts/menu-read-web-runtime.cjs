// FIX: retain the deployed graph, React owner and all runtime-only screen behavior.
const fs=require('fs'),path=require('path'),esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');
function build(input,output){
 const cache={},files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
 const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])?.[1];if(!entry)throw Error('entry missing');
 let s=files['assets/'+entry];
 function replace(a,b){if(s.split(a).length!==2)throw Error('web guard '+a);s=s.replace(a,b);}
 replace('async function M9(t,n){return z(`/tsd/requests/${n}`,{accessToken:t})}', 'async function M9(t,n){return __MenuReads.sharedRead(JSON.stringify([t,n,"assembly"]),()=>z(`/tsd/requests/${n}`,{accessToken:t}))}');
 replace('async function D9(t,n){return z(`/tsd/requests/${n}/fbo`,{accessToken:t})}', 'async function D9(t,n){return __MenuReads.sharedRead(JSON.stringify([t,n,"fbo"]),()=>z(`/tsd/requests/${n}/fbo`,{accessToken:t}))}');
 const compile=(contents,globalName,loader)=>esbuild.buildSync({stdin:{contents,loader},bundle:true,write:false,format:'iife',globalName,minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
 const source=fs.readFileSync(path.join(__dirname,'../apps/web/src/components/warehouse/ReceiptDirectionsPanel.tsx'),'utf8').replace(/^import .*;\r?\n/gm,'');
 s+='\n'+compile('const React=x;const {useEffect,useRef,useState}=x;\n'+source,'__ReceiptDirections','tsx');
 s+='\n'+compile(fs.readFileSync(path.join(__dirname,'../apps/web/src/lib/shared-read.ts'),'utf8'),'__MenuReads','ts');
 cache['assets/'+entry]=s;
 const result=repair(files,entry,entry,'menu-reads-20261009');
 for(const[n,data]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
 return Object.keys(result);
}
module.exports={build};if(require.main===module)console.log(JSON.stringify(build(...process.argv.slice(2))));
