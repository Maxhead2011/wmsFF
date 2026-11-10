// FIX: immutable FBS-only overlay; root React singleton and prior Ozon modules retained.
const fs=require('fs'),path=require('path'),a=require('node:assert/strict');
const root=path.resolve(process.argv[2]),base=root+'/web-base',out=root+'/web-payload';
const oldName='ozon-documents-fbs-20261110.js',newName='fbs-archive-20261110.js';
let s=fs.readFileSync(base+'/assets/'+oldName,'utf8');const original=s,changes=[];
function replace(before,after){a.equal(s.split(before).length,2,before);s=s.replace(before,after);changes.push([before,after])}
const helpers=`
// FIX: bounded read-only archive request; never fetch full marketplace history.
function __archiveDefault(now=new Date()){const to=new Date(now.getTime()+10800000).toISOString().slice(0,10);return {from:new Date(Date.parse(to+'T00:00:00Z')-172800000).toISOString().slice(0,10),to}}
async function __archiveFetch(token,clientId,period,allBranches,warehouse){const q=new URLSearchParams({clientId,view:'archive',archiveFrom:period.from,archiveTo:period.to,allBranches:allBranches?'1':'0'});if(warehouse)q.set('displayWarehouseId',warehouse);const response=await fetch('/api/v1/marketplace-connections/fbs/orders?'+q,{headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(Array.isArray(error.message)?error.message.join(' '):error.message||'Не удалось загрузить архив FBS.')}return response.json()}
`;
replace('const __fbsRoot=c.useRef(null);','const __fbsRoot=c.useRef(null);const [__archivePeriod,__setArchivePeriod]=c.useState(__archiveDefault);');
replace('const E=await Gt(s.accessToken,f,o,"snapshot",d,u);','const E=await ((p==="shipped"||p==="archive")?__archiveFetch(s.accessToken,f,__archivePeriod,d,u):Gt(s.accessToken,f,o,"snapshot",d,u));');
replace('},[a,f,s.accessToken,d,u]);async function we()', '},[a,f,s.accessToken,d,u,p==="shipped"||p==="archive",__archivePeriod.from,__archivePeriod.to]);async function we()');
replace('e.jsx(__FbsCompactHistory,{','e.jsx(__FbsCompactHistory,{archivePeriod:__archivePeriod,onArchivePeriodChange:__setArchivePeriod,');
replace('function __ClientStoresOriginalTable({data:s,','function __ClientStoresOriginalTable({archivePeriod:__period,onArchivePeriodChange:__changePeriod,data:s,');
replace('Me=r==="shipped"?Ai(H,se,de):H','Me=r==="shipped"&&!__period?Ai(H,se,de):H');
replace('value:se,onChange:m=>Ce(m.target.value)','value:__period?.from??se,onChange:m=>{Ce(m.target.value);__changePeriod?.({...__period,from:m.target.value})}');
replace('value:de,onChange:m=>ue(m.target.value)','value:__period?.to??de,onChange:m=>{ue(m.target.value);__changePeriod?.({...__period,to:m.target.value})}');
replace('disabled:!se&&!de,onClick:()=>{Ce(""),ue("")},children:"Сбросить даты"','disabled:false,onClick:()=>{const d=__archiveDefault();Ce(d.from);ue(d.to);__changePeriod?.(d)},children:"Последние 3 дня"');
replace('Заказы ниже автоматически свёрнуты по дням.','Загружается выбранный период. Если дата отгрузки не сохранена — используется дата заказа.');
replace('Завершённые заказы за последние 30 дней будут храниться здесь.','Завершённые заказы за выбранный период.');
let inverse=s;for(const [before,after] of [...changes].reverse())inverse=inverse.replace(after,before);a.equal(inverse,original);
fs.mkdirSync(out+'/assets',{recursive:true});fs.writeFileSync(out+'/assets/'+newName,helpers+s);
let index=fs.readFileSync(base+'/index.html','utf8');const before=index;
index=index.replaceAll('/assets/'+oldName,'/assets/'+newName);
const m=index.match(/<script type="importmap">([\s\S]*?)<\/script>/);a(m);const map=JSON.parse(m[1]);map.imports['/assets/'+oldName]='/assets/'+newName;index=index.replace(m[1],JSON.stringify(map));a.notEqual(index,before);fs.writeFileSync(out+'/index.html',index);
console.log('PASS web2 exact inverse patch; parent range -> child dates -> bounded API; singleton unchanged');
