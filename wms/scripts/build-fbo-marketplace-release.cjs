const fs=require('node:fs'),path=require('node:path');
const {repair}=require('./single-react-graph.cjs');
// FIX: apply only the marketplace discriminator to the verified production runtime.
function once(s,a,b){if(s.split(a).length!==2)throw Error('Runtime anchor drift: '+a);return s.replace(a,b);}
function build(root){
 const apiName='modules/client-requests/client-requests.service.js',apiPath=path.join(root,'api',apiName);
 let api=fs.readFileSync(apiPath,'utf8');
 const newline=api.includes('\r\n')?'\r\n':'\n';
 api=once(api,'            include: clientRequestInclude,'+newline+'            orderBy: [{ updatedAt:',"            include: { ...clientRequestInclude, ...(process.env.WMS_OZON_FBO_IMPORT_ENABLED === 'true' ? { ozonShipment: { select: { requestId: true } } } : {}) },"+newline+'            orderBy: [{ updatedAt:');
 const dest=path.join(root,'api-image/overlay',apiName);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,api);
 fs.writeFileSync(path.join(root,'api-changes.json'),JSON.stringify([apiName]));
 const cache={},files=new Proxy(cache,{get(t,n){if(!(n in t)){const p=path.join(root,'web-base',n);t[n]=fs.existsSync(p)?fs.readFileSync(p,'utf8'):undefined;}return t[n];}});
 const entry=/src="\/assets\/([^"/]+\.js)"/.exec(files['index.html'])[1];
 const graph=new Set(),pending=['index.html'];let changed=0;
 while(pending.length){const n=pending.pop();if(graph.has(n))continue;graph.add(n);let s=files[n];
  for(const token of s.match(/[\w.$-]{1,240}\.js/g)||[]){const next='assets/'+token;if(files[next]&&!graph.has(next))pending.push(next);}
  if(!s.includes('function xr({fboOnly:'))continue;
  s=once(s,'function Vt(s){var t,d;return s.type==="OUTBOUND"&&','function Vt(s){var t,d;return s.type==="OUTBOUND"&&!s.ozonShipment&&');
  s=once(s,'e.jsx(__Ozon.OzonCustomerImport,{clients:Gs,session:t,onCreated:()=>void ke()})','!s&&e.jsx(__Ozon.OzonCustomerImport,{clients:Gs,session:t,onCreated:()=>void ke()})');
  cache[n]=s;changed++;
 }
 if(changed!==1)throw Error('Expected one client requests panel');
 const result=repair(files,entry,entry,'fbo-marketplace-20261009');
 for(const[n,s]of Object.entries(result)){const p=path.join(root,'web',n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
 fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(Object.keys(result)));
 return {api:[apiName],web:Object.keys(result)};
}
module.exports={build};if(require.main===module)console.log(JSON.stringify(build(process.argv[2])));
