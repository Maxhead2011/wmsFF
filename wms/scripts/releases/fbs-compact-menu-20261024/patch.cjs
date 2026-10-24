// FIX: change navigation only in the current live FBS module; retain allocation hub and all actions.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]), oldName='fbs-filtered-selection-20261023.js', newName='fbs-compact-menu-20261024.js';
const original=fs.readFileSync(path.join(root,'web-base/assets',oldName),'utf8');
const ast=ts.createSourceFile(oldName,original,99,true,1);
const matches=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.getText(ast).includes('"aria-label":"Разделы FBS"'));
assert.equal(matches.length,1);const fn=matches[0],prefix=original.slice(0,fn.getStart(ast)),suffix=original.slice(fn.end);let s=fn.getText(ast);
function replace(a,b){assert.equal(s.split(a).length,2,'Expected one occurrence: '+a);s=s.replace(a,b);}
replace('const o=a!=="WILDBERRIES"?gn.filter(E=>!ii.has(E.id)):gn,','const menu=__fbsCompactViews();const o=a!=="WILDBERRIES"?menu.filter(E=>!ii.has(E.id)):menu,');
replace('ks.some(o=>o.id===p)||j("active")','(ks.some(o=>o.id===__fbsCompactGroup(p))&&!(p==="pricing"&&!es)&&!(p==="calculator"&&!Gs))||j("active")');
replace('[p,ks]);const Ps=ks.find(o=>o.id===p)', '[p,ks,es,Gs]);const Ps=ks.find(o=>o.id===__fbsCompactGroup(p))');
replace('G=p===o.id;', 'G=__fbsCompactGroup(p)===o.id;');
replace('shipped:(Ot=Q==null?void 0:Q.sync)!=null&&Ot.partial?"…":(Q==null?void 0:Q.counts.shipped)??0,','shipped:Q?.sync?.partial?"…":(Q?.counts.shipped??0)+(Q?.counts.archive??0)+(Q?.counts.cancelled??0),');
replace('cost:(qt=Q==null?void 0:Q.sync)!=null&&qt.partial?"…":(Q==null?void 0:Q.counts.shipped)??0,','cost:"тарифы",');
replace('p==="reshipment"&&a==="WILDBERRIES"?f?', 'e.jsx(__FbsCompactSubnav,{view:p,setView:j,clear:()=>ze(new Set),calculator:Gs,pricing:es}),p==="reshipment"&&a==="WILDBERRIES"?f?');
replace('e.jsx(ki,{data:Q,session:s,view:p,','e.jsx(__FbsCompactHistory,{data:Q,session:s,view:p,');
const helpers=`
function __fbsCompactGroup(view){return view==='reshipment'?'deadlines':view==='stocks'?'allocation':['cancelled','archive'].includes(view)?'shipped':['calculator','pricing'].includes(view)?'cost':view;}
function __fbsCompactViews(){return gn.filter(v=>!['stocks','cargo','cancelled','archive','calculator','pricing','reshipment'].includes(v.id)).map(v=>v.id==='deadlines'?{...v,title:'Проблемные заявки',description:'Контроль автоотмены и повторный довоз WB.'}:v.id==='allocation'?{...v,title:'Управление автоматическим распределением остатков',description:'Товары, публикация и правила распределения по складам.'}:v.id==='shipped'?{...v,title:'Архив заявок',description:'Отгруженные, полученные покупателями и отменённые заказы.'}:v.id==='cost'?{...v,title:'Настройки стоимости',description:'Стоимость обработки, калькулятор и назначение тарифов.'}:v);}
function __FbsCompactSubnav({view,setView,clear,calculator,pricing}){const group=__fbsCompactGroup(view);let title='',items=[];if(group==='deadlines'){title='Проблемные заявки';items=[['deadlines','Контроль автоотмены'],['reshipment','Повторный довоз']];}if(group==='shipped'){title='Архив заявок';items=[['shipped','Отгруженные'],['cancelled','Отменённые заказы']];}if(group==='cost'){title='Настройки стоимости';items=[['cost','Стоимость обработки FBS'],...(calculator?[['calculator','Калькулятор стоимости']]:[]),...(pricing?[['pricing','Назначение стоимости обработки']]:[])];}return items.length?e.jsx('nav',{className:'fbs-section-tabs','aria-label':title,children:items.map(([id,label])=>e.jsx('button',{type:'button','aria-pressed':view===id||(view==='archive'&&id==='shipped'),onClick:()=>{clear();setView(id)},children:label},id))}):null;}
function __FbsCompactHistory(props){if(!['shipped','archive'].includes(props.view))return e.jsx(ki,props);return e.jsxs('div',{className:'fbs-history-orders',children:[e.jsxs('section',{'aria-label':'Переданные в доставку',children:[e.jsx('h3',{children:'Переданные в доставку'}),e.jsx(ki,{...props,view:'shipped'})]}),props.data?.orders.some(o=>o.category==='archive')?e.jsxs('section',{'aria-label':'Получены покупателями',children:[e.jsx('h3',{children:'Получены покупателями'}),e.jsx(ki,{...props,view:'archive'})]}):null]});}
`;
const next=prefix+s+suffix+'\n'+helpers;
assert.equal(ts.createSourceFile(newName,next,99,true,1).parseDiagnostics.length,0);
assert.equal(next.slice(0,prefix.length),prefix);assert.equal(next.slice(prefix.length+s.length,prefix.length+s.length+suffix.length),suffix);
const payload=path.join(root,'payload');fs.mkdirSync(path.join(payload,'assets'),{recursive:true});fs.writeFileSync(path.join(payload,'assets',newName),next);
const cssSource=fs.readFileSync(path.resolve(__dirname,'../../../apps/web/src/components/fbs/fbs.css'),'utf8');const css=cssSource.slice(cssSource.indexOf('/* FIX: grouped FBS navigation'));
assert(css.startsWith('/* FIX:'));fs.writeFileSync(path.join(payload,'assets/fbs-compact-menu-20261024.css'),css);
const html=fs.readFileSync(path.join(root,'web-base/index.html'),'utf8');const start=html.indexOf('<script type="importmap">')+'<script type="importmap">'.length,end=html.indexOf('</script>',start);const map=JSON.parse(html.slice(start,end));assert.equal(map.imports['/assets/admin-tiles-20261019-28.js'],'/assets/'+oldName);map.imports['/assets/admin-tiles-20261019-28.js']='/assets/'+newName;map.imports['/assets/'+oldName]='/assets/'+newName;
fs.writeFileSync(path.join(payload,'index.html'),(html.slice(0,start)+JSON.stringify(map)+html.slice(end)).replace('</head>','<link rel="stylesheet" href="/assets/fbs-compact-menu-20261024.css">\n</head>'));
fs.writeFileSync(path.join(root,'patch-proof.json'),JSON.stringify({changedFunctions:[fn.name.text],helpers:4,retainedAllocationHub:true,unchangedPrefixBytes:prefix.length,unchangedSuffixBytes:suffix.length,changedFiles:['index.html','assets/'+newName,'assets/fbs-compact-menu-20261024.css']}));
console.log('Patched only navigation; all stock, allocation, reshipment and order operation functions retained byte-for-byte.');
