// Exact overlay over current Requests; preserve existing handlers and import graph.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const r=path.resolve(process.argv[2]),out=path.join(r,'web/payload'),old='assets/panthera-market-buttons-20261101.js',next='assets/compact-request-tools-20261101.js',css='assets/compact-request-tools-20261101.css';
fs.mkdirSync(path.join(out,'assets'),{recursive:true});
function once(text,a,b){assert.equal(text.split(a).length,2,'anchor: '+a.slice(0,70));return text.replace(a,()=>b);}
let text=fs.readFileSync(path.join(r,'requests.js'),'utf8');const tree=ts.createSourceFile('requests.js',text,99,true,ts.ScriptKind.JS);
const arrays=[];function visit(n){if(ts.isArrayLiteralExpression(n)&&n.elements[0]?.getText(tree).startsWith('e.jsx(__OperationsTools.OperationsTools,'))arrays.push(n);ts.forEachChild(n,visit);}visit(tree);assert.equal(arrays.length,1);
const arr=arrays[0],children=arr.elements.map(x=>x.getText(tree)),extract=token=>{const idx=children.findIndex(x=>x.includes(token));assert(idx>=0,token);return children.splice(idx,1)[0];};
const tools=children.shift(),heading=extract('section-heading client-requests-panel__heading');
const ozon='!s&&e.jsx(__Ozon.OzonCustomerImport,{clients:Gs,session:t,onCreated:()=>void ke()})';
let excel=extract('className:"client-request-excel-collapse"');excel=once(once(excel,ozon+',',''),'className:"client-request-excel-collapse"','className:"client-request-excel-collapse request-fold"');
let tails=extract('className:"client-request-fbs-tails"');const t='e.jsx("strong",{children:"Новая заявка из хвостов FBS"})';tails=once(tails,t+',','');const then=tails.indexOf('?e.jsxs("section"');assert(then>0&&tails.endsWith(':null'));tails=tails.slice(0,then)+'?e.jsxs("details",{className:"request-fold",children:[e.jsx("summary",{children:"Новая заявка из хвостов FBS"}),'+tails.slice(then+1,-5)+']}):null';
const pos=children.findIndex(x=>x.startsWith('te?e.jsx("p"'));assert(pos>=0);children.splice(pos,0,'!Se&&h&&ae.status==="ready"&&'+ozon);
text=text.slice(0,arr.getStart(tree))+'['+[heading,tools,excel,tails,...children].join(',')+']'+text.slice(arr.end);
const start=text.indexOf('className:"operations-tools",style:'),end=text.indexOf('maxLength:512,style:{width:"100%"}',start)+34;assert(start>=0&&end>start);
let form=text.slice(start,end);
form=once(form,'className:"operations-tools",style:{border:"1px solid var(--border-color, #d8dfe5)",borderRadius:14,padding:16,marginBottom:16}','className:"operations-tools request-fold"');
form=once(form,'{style:{fontWeight:700,cursor:"pointer"}}','null');form=once(form,',style:{display:"flex",flexWrap:"wrap",gap:8,margin:"12px 0"}','');form=once(form,',style:{display:"flex",gap:8,flexWrap:"wrap"}','');form=once(form,'{style:{flex:"1 1 240px"}}','null');
text=text.slice(0,start)+form+text.slice(end);
assert.equal(ts.createSourceFile('patched.js',text,99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);
fs.writeFileSync(path.join(out,next),text);fs.copyFileSync('apps/web/src/components/client-requests/operations-tools.css',path.join(out,css));
let html=fs.readFileSync(path.join(r,'index.html'),'utf8');const m=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(m[1]);assert.equal(map.imports['/assets/admin-tiles-20261019-4.js'],'/'+old);
for(const k of Object.keys(map.imports))if(map.imports[k]==='/'+old)map.imports[k]='/'+next;map.imports['/'+old]='/'+next;
fs.writeFileSync(path.join(out,'index.html'),once(once(html,m[1],JSON.stringify(map)),'</head>','<link rel="stylesheet" href="/'+css+'"></head>'));
fs.writeFileSync(path.join(r,'web-changes.json'),JSON.stringify(['index.html',next,css]));
