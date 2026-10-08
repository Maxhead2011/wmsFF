// FIX: patch only the deployed FBO window, preserving runtime-only business features.
const fs=require('node:fs'),path=require('node:path');
const {repair}=require('./single-react-graph.cjs');
function patch(s){
 const start=s.indexOf('function Bi('),end=s.indexOf('function ',start+20);
 if(start<0||end<0)throw Error('FBO function missing');
 const replace=(a,b)=>{if(s.split(a).length!==2)throw Error('Expected unique runtime anchor: '+a.slice(0,100));s=s.replace(a,b);};
 replace('function Bi({initial:s,accessToken:t,userId:d,canWrite:r,onClose:u}){var xe;', 'function Bi({initial:s,accessToken:t,userId:d,canWrite:r,onClose:u}){var xe;const[$windowReading,$setWindowReading]=o.useState(false);');
 replace('async function S(){if(!(N.current||C)){N.current=!0,te(!0);','async function S(){if(!N.current){N.current=!0,$setWindowReading(true),te(!0);');
 replace('N.current=!1,Q.current&&te(!1)', 'N.current=!1,Q.current&&(te(!1),$setWindowReading(false))');
 const hs=s.indexOf('e.jsxs("header",',start),he=s.indexOf(']}),e.jsx(Ii,',hs)+3;
 if(hs<0||he<hs)throw Error('Header missing');
 const header=s.slice(hs,he),bs=header.indexOf('e.jsx("button",'),ts=header.indexOf('e.jsxs("h2",');
 let button=header.slice(bs,ts-1).replace('disabled:V||!!C','disabled:V&&!$windowReading').replaceAll('Закрыть просмотр ФБО','Закрыть');
 const title=header.slice(ts,-3);
 s=s.slice(0,hs)+'e.jsxs("header",{className:"online-execution-modal__header",style:{position:"sticky",top:0,zIndex:2,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,background:"var(--surface, #fff)",padding:"8px 0"},children:['+title+',e.jsx("div",{className:"online-execution-modal__actions",style:{display:"flex",gap:8},children:'+button+'})]})'+s.slice(he);
 replace('disabled:V||!!C,onClick:()=>void S()','disabled:V,onClick:()=>void S()');
 replace('disabled:V||!!C,onClick:u','disabled:V&&!$windowReading,onClick:u');
 return s;
}
module.exports={patch};
if(require.main===module){
 const [input,output]=process.argv.slice(2),cache={};
 const files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(input,n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
 cache['assets/single-react-20261008-24.js']=patch(files['assets/single-react-20261008-24.js']);
 const result=repair(files,'single-react-20261008-29.js','single-react-20261008-29.js','fbo-window-20261008');
 for(const[n,s]of Object.entries(result)){const p=path.join(output,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
 fs.writeFileSync(path.join(output,'../web-changes.json'),JSON.stringify(Object.keys(result)));
 console.log('Patched graph:',Object.keys(result).length);
}
