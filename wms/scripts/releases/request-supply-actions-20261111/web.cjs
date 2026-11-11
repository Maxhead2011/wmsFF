const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('../../../node_modules/typescript');
const root = path.resolve(process.argv[2]);
const out = path.join(root, 'web-payload');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, value) => {
  const target = path.join(out, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
};
const requests = 'assets/market-status-open-20261110.js';
const fbs = 'assets/fbs-archive-20261110.js';
const nextRequests = 'assets/request-supply-buttons-20261111.js';
const nextFbs = 'assets/request-supply-fbs-20261111.js';
const bridge = 'assets/request-supply-action-20261111.js';
function patch(source, edits) {
  for (const [before, after] of edits) {
    assert.equal(source.split(before).length, 2, before);
    source = source.replace(before, () => after);
  }
  return source;
}
const helper = path.resolve(__dirname, '../../../apps/web/src/components/fbs/requestSupplyAction.ts');
write(bridge, ts.transpileModule(fs.readFileSync(helper, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText + '\nlet pending = null;\nexport function getTarget(){return pending;}\nexport function setTarget(target){pending=target;}\n');
const requestAnchor = 'className:"client-request-actions",children:[';
const actions = `le&&Ye(c)&&c.wbSupplyIds?.length?e.jsx("button",{className:"client-request-action-button client-request-action-button--supply-transfer",type:"button",disabled:!c.fbsCompletion?.completed||["DONE","CANCELLED","REJECTED"].includes(c.status),onClick:()=>{__setSupplyTarget({request:c,action:"deliver"});le(c)},children:"Передать на МП"}):null,
  le&&Ye(c)&&c.wbSupplyIds?.length?e.jsxs("details",{className:"request-action-menu__group request-supply-labels",children:[e.jsx("summary",{children:"Стикеры поставки"}),e.jsxs("div",{className:"request-action-menu__items",children:[e.jsx("button",{type:"button",onClick:()=>{__setSupplyTarget({request:c,action:"download"});le(c)},children:"Скачать все ШК"}),e.jsx("button",{type:"button",onClick:()=>{__setSupplyTarget({request:c,action:"print"});le(c)},children:"Распечатать все ШК"})]})]}):null,`;
const menuAnchor = 'const menu = jsx("div", { className: "request-action-menu", children: [';
write(nextRequests, `import{setTarget as __setSupplyTarget}from"/${bridge}";\n` + patch(read(requests), [
  [requestAnchor, requestAnchor + actions],
  [menuAnchor, menuAnchor + '\n      action("supply-transfer"), actions.find(n=>has(n,"request-supply-labels")),'],
]));
const readyAnchor = 'ce.current===y&&K({status:"ready",data:E,error:""})';
const deliveryAnchor = 'async function pa(o)';
const effect = `c.useEffect(()=>{
  const target=__getSupplyTarget();
  if(!target||!__fbsRoot.current||__fbsRoot.current.closest("[hidden]"))return;
  if(a!=="WILDBERRIES"){r("WILDBERRIES");return;}
  if(f!==target.request.clientId){h(target.request.clientId);return;}
  if(target.request.status==="DONE"){
    const period={...__archiveDefault(),from:target.request.createdAt.slice(0,10)};
    const key=period.from+"/"+period.to;
    if(p!=="archive"||__archivePeriod.from+"/"+__archivePeriod.to!==key){__setArchivePeriod(period);j("archive");return;}
    if(U.status!=="error"&&__supplyArchive.current!==key)return;
  }else if(p!=="active"){j("active");return;}
  if(U.status==="error"){__setSupplyTarget(null);return;}
  if(U.status!=="ready"||U.data.client.id!==f||ns!==null)return;
  __setSupplyTarget(null);
  try{
    const orders=__requestSupplyOrders(target,U.data.orders);
    if(target.action==="deliver")void pa(orders);
    else void ga(orders,target.action==="print"?"print":true);
  }catch(error){le(error instanceof Error?error.message:"Не удалось открыть поставку.");}
});`;
write(nextFbs, `import{getTarget as __getSupplyTarget,setTarget as __setSupplyTarget,requestSupplyOrders as __requestSupplyOrders}from"/${bridge}";\n` + patch(read(fbs), [
  ['function nc(s){const[t,a]=c.useState(null)', 'function nc(s){const[t,a]=c.useState(()=>__getSupplyTarget()?"WILDBERRIES":null)'],
  ['const __fbsRoot=c.useRef(null);', 'const __fbsRoot=c.useRef(null);const __supplyArchive=c.useRef(null);'],
  [readyAnchor, 'ce.current===y&&(__supplyArchive.current=p==="shipped"||p==="archive"?__archivePeriod.from+"/"+__archivePeriod.to:null,K({status:"ready",data:E,error:""}))'],
  [deliveryAnchor, effect + deliveryAnchor],
]));
const html = read('index.html');
const match = html.match(/<script type="importmap">(.*?)<\/script>/s);
assert(match);
const map = JSON.parse(match[1]);
for (const [old, next] of [[requests, nextRequests], [fbs, nextFbs]]) {
  assert(Object.values(map.imports).includes('/' + old));
  for (const key of Object.keys(map.imports)) {
    if (map.imports[key] === '/' + old) map.imports[key] = '/' + next;
  }
  map.imports['/' + old] = '/' + next;
}
write('index.html', html.replace(match[1], () => JSON.stringify(map)));
fs.writeFileSync(path.join(root, 'web-changes.json'), JSON.stringify(['index.html', nextRequests, nextFbs, bridge]));
