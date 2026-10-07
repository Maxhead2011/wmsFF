// FIX: only expose the existing status state and filter topic metrics in the pinned live graph.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {edits}=require('./billing-done-requests-release.cjs');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const PIN='b0ceef087d2b3fa83f2f9e70b4d1385b7451d012932049258a487ab16b8f1abd';
const control='e.jsxs("label",{children:[e.jsx("span",{children:"Статус"}),e.jsxs("select",{value:se,onChange:n=>at(n.target.value),children:[e.jsx("option",{value:"",children:"Все статусы"}),rs.map(n=>e.jsx("option",{value:n.value,children:n.label},n.value))]})]})';
function patch(source){
 if(sha(source)!==PIN)throw Error('Live billing graph drift');
 return edits(source,[[control,control.replace('children:"Статус"','children:"Статус счёта"').replace('value:se,','"aria-label":"Статус счёта",value:se,')],
 ['className:"billing-invoice-period","aria-label":"Период счетов",children:[','className:"billing-invoice-period","aria-label":"Период счетов",children:['+control.replace('children:"Статус"','children:"Статус счёта"').replace('value:se,','"aria-label":"Статус счёта",value:se,')+','],
 ['ie.filter(p=>xs(p,n)&&js(p,ne,c))','ie.filter(p=>xs(p,n)&&(!se||p.status===se)&&js(p,ne,c))'],
 ['}),[ne,c,ie]),rt=r.useMemo','}),[ne,c,se,ie]),rt=r.useMemo']]);
}
function build(base,out){
 if(fs.existsSync(out))throw Error('Fresh output required');fs.mkdirSync(out,{recursive:true});fs.mkdirSync(out+'/web');
 const html=fs.readFileSync(base+'/index.html','utf8'),entry=html.match(/src="\/assets\/([^"/]+\.js)"/)[1],graph=new Map(),stack=[entry];
 while(stack.length){const n=stack.pop();if(graph.has(n))continue;const s=fs.readFileSync(base+'/assets/'+n,'utf8');graph.set(n,s);for(const m of s.matchAll(/["']([^"']+\.js)["']/g)){const ref=path.basename(m[1]);if(fs.existsSync(base+'/assets/'+ref)&&!graph.has(ref))stack.push(ref)}}
 const targets=[...graph].filter(([,s])=>sha(s)===PIN);if(targets.length!==1)throw Error('Pinned billing module missing');
 const names=Object.fromEntries([...graph.keys()].map((n,i)=>[n,`billing-invoice-status-20261003-${i}.js`])),files={};
 for(const[n,s]of graph){const next=(n===targets[0][0]?patch(s):s).replace(/[\w.-]+\.js/g,v=>names[v]||v);fs.writeFileSync(out+'/web/'+names[n],next);files[names[n]]={sha256:sha(next),original:n,originalSha256:sha(s)}}
 const index=edits(html,[['/assets/'+entry,'/assets/'+names[entry]]]);fs.writeFileSync(out+'/web/index.html',index);
 fs.writeFileSync(out+'/web/proof.json',JSON.stringify({indexBeforeSha:sha(html),indexAfterSha:sha(index),files,billing:names[targets[0][0]],entry:names[entry]},null,2));
 console.log(JSON.stringify({chunks:graph.size,billing:names[targets[0][0]]}));
}
module.exports={patch,build,PIN};if(require.main===module)build(...process.argv.slice(2));
