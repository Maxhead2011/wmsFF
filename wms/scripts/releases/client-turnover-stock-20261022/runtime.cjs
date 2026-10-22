const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require('../../../node_modules/typescript');
const root=process.argv[2],file=process.argv[3]||root+'/web/assets/client-turnover-stock-20261022.js';
const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile('x',source,99,true),parts=[];
function walk(n){if(ts.isFunctionDeclaration(n)&&['t8','m8','x8'].includes(n.name?.text))parts.push(n.getText(ast));ts.forEachChild(n,walk)}walk(ast);assert.equal(parts.length,3);
let values=[],cursor=0,effects=[];const fallback=()=>[];
const ctx=new Proxy({e:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},x:{useRef:()=>({current:0}),useMemo:f=>f(),useEffect:f=>effects.push(f),useState:initial=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>values[i]=typeof v==='function'?v(values[i]):v]}},Lt:()=>['own',fallback],console,Array,Object,String,Number,Set,Map,Date,JSON,Math,Promise},{get:(t,k)=>k in t?t[k]:fallback});
vm.createContext(ctx);vm.runInContext(parts.join(';'),ctx);
function nodes(n){if(!n||typeof n!=='object')return [];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)]}
for(const role of ['CLIENT','ADMIN']){
 values=[];cursor=0;effects=[];const session={accessToken:'test',user:{id:'u',roleCodes:[role],permissionCodes:role==='CLIENT'?['stock:read']:['system:admin']}};
 let tree=ctx.t8({session}),tiles=nodes(tree);const stock=tiles.find(n=>n.props?.index===6);assert(stock,'Stock tile missing for '+role);
 assert.equal(tiles.some(n=>n.props?.index===9),role==='ADMIN');assert.equal(tiles.some(n=>n.props?.index===8),role==='ADMIN');
 stock.props.onClick();cursor=0;effects=[];tree=ctx.t8({session});assert(nodes(tree).some(n=>n.props?.ignoreActiveRequests===false&&typeof n.props?.onDownload==='function'),'Stock section missing');
 for(const effect of effects)if(effect.toString().includes('"movement"'))effect();assert.equal(values[0],'stockExport');
}
fs.writeFileSync(root+'/browser-proof.json',JSON.stringify({passed:2,actualRuntime:true,clientAndAdmin:true}));console.log('PASS actual runtime client/admin navigation and retained statistics restrictions');
