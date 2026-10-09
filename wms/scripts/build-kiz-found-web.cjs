const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../apps/web/node_modules/vite/package.json'))('esbuild');
const {repair}=require('./single-react-graph.cjs');
// FIX: replace only the scoped KIZ screen; preserve the one deployed React graph and other workflows.
function build(input,output){
 const cache={},files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
 const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];let main=files['assets/'+entry];
 const ast=ts.createSourceFile('runtime.js',main,ts.ScriptTarget.Latest,true);
 const screen=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='m4'&&n.getText(ast).includes('Проверка КИЗов'));
 if(!screen||!main.includes('function l0(t,n){return z("/inventory/kiz-location/check"'))throw Error('KIZ runtime drift');
 const read=n=>fs.readFileSync(path.join(__dirname,'../apps/web/src/components/kiz',n+'.tsx'),'utf8').replace(/^import .*;\r?\n/gm,'');
 const code=`const React=x;const {useEffect,useState,useRef}=x;const checkKizHistory=l0;
 function fetchFoundKiz(accessToken){return z('/inventory/kiz-found',{accessToken});}
 function foundKizAction(accessToken,body){return z('/inventory/kiz-found',{accessToken,method:'POST',body});}
 function KizReviewQueuePanel(props){return React.createElement(React.Fragment,null,React.createElement(KizFoundPanel,{session:props.session}),React.createElement(f4,props));}
 `+read('KizFoundPanel')+read('KizCheckPanel');
 const compiled=esbuild.buildSync({stdin:{contents:code,loader:'tsx'},define:{'import.meta.env.VITE_KIZ_FOUND_REVIEW_ENABLED':'"true"','import.meta.env.VITE_KIZ_REVIEW_QUEUE_ENABLED':'"true"'},bundle:true,write:false,format:'iife',globalName:'__FoundKiz',minify:true,jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).outputFiles[0].text;
 main=main.slice(0,screen.getStart(ast))+'function m4(props){return e.jsx(__FoundKiz.KizCheckPanel,props)}'+main.slice(screen.end)+'\n'+compiled;
 cache['assets/'+entry]=main;const result=repair(files,entry,entry,'kiz-found-20261009');
 for(const[n,data]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
 return Object.keys(result);
}
module.exports={build};if(require.main===module)console.log(JSON.stringify(build(...process.argv.slice(2))));
