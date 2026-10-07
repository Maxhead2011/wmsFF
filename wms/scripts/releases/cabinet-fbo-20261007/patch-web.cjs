const fs=require('fs'),path=require('path'),ts=require('../fix-fbo-plan-timeout/wms/node_modules/typescript');
const r=__dirname,graph=JSON.parse(fs.readFileSync(r+'/web-graph.json','utf8')),files=Object.fromEntries(graph.map(n=>[n,fs.readFileSync(r+'/web-base/'+n,'utf8')]));
function replace(s,a,b){if(s.split(a).length!==2)throw Error('Anchor mismatch '+a.slice(0,120));return s.replace(a,b);}
function fnPatch(file,name,change){let s=files[file],ast=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!node)throw Error('Missing function '+name);const old=node.getText(ast),updated=change(old);files[file]=replace(s,old,updated);fs.writeFileSync(r+'/patched-function-'+name+'.js',updated);}
const main='assets/invoice-full-receipt-20261005-0-payrollcorrections.js',fbo='assets/invoice-full-receipt-20261005-6-payrollcorrections.js';
fnPatch(main,'IL',s=>{
 s=replace(s,'function IL(t,n,s,r=[]){','async function IL(t,n,s,r=[],audit){const generatedAt=new Date(),fileName=$L(t.code);');
 s=replace(s,'new Date().toLocaleString("ru-RU")','generatedAt.toLocaleString("ru-RU")');
 return replace(s,'BL($L(t.code),u)',`if(audit) await wmsRecordCabinetExport(audit.accessToken,{clientId:t.id,fileName,generatedAt:generatedAt.toISOString(),filters:{search:audit.search,section:audit.section,scope:"all_filtered_rows"},rows:l.map(row=>({name:String(row.name??""),article:String(row.article??""),barcode:String(row.barcode??""),color:String(row.color??""),size:String(row.size??""),quantity:row.quantity}))});BL(fileName,u)`);
});
files[main]+=`\nasync function wmsRecordCabinetExport(token,snapshot){const response=await fetch("/api/v1/stock/cabinet-export-audit",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(snapshot)});if(!response.ok){let message="Не удалось сохранить выгрузку в журнал. Повторите скачивание.";try{const error=await response.json();if(error.message)message=Array.isArray(error.message)?error.message.join("; "):error.message;}catch{}throw Error(message);}return response.json();}\n`;
fnPatch(main,'WL',s=>{
 s=replace(s,'}){const q=', '}){const [wmsExporting,setWmsExporting]=x.useState(false);const q=');
 s=replace(s,'onClick:()=>IL(n,i,q,l),disabled:i.length===0','onClick:async()=>{if(wmsExporting)return;setWmsExporting(true);D("");try{await IL(n,i,q,l,{accessToken:t,search:c,section:b});}catch(error){D(error instanceof Error?error.message:"Не удалось сохранить выгрузку в журнал.");}finally{setWmsExporting(false);}},disabled:i.length===0||wmsExporting');
 return replace(s,'children:"Остатки Excel"','children:wmsExporting?"Подготовка Excel…":"Остатки Excel"');
});
for(const name of ['Zl','li'])fnPatch(fbo,name,s=>{
 const text='s.pendingPlacementQuantity>0?` Принято, ожидает размещения: ${s.pendingPlacementQuantity} шт. Готово к отбору: ${s.readyQuantity??0}.`:""';
 s=replace(s,`function ${name}(s){`,`function ${name}(s){const placementText=${text};`);
 s=s.replaceAll('${s.reservedQuantity}.','${s.reservedQuantity}.${placementText}');return s;
});
fnPatch(fbo,'Ii',s=>{
 s=replace(s,'"aria-label":"Онлайн-выполнение FBO",children:[','"aria-label":"Онлайн-выполнение FBO",children:[s.pendingPlacementQuantity>0&&e.jsx("p",{role:"status",children:`Принято, ожидает размещения: ${s.pendingPlacementQuantity} шт.`}),');
 return replace(s,'p.remaining>0&&!s.route.some', 'p.pendingPlacementQuantity>0?`Принято, ожидает размещения: ${p.pendingPlacementQuantity} шт.`:p.remaining>0&&!s.route.some');
});
fnPatch(fbo,'Bi',s=>{
 const marker='a.shortage>0&&';if(!s.includes(marker))throw Error('FBO state alias changed');
 return replace(s,marker,'a.pendingPlacementQuantity>0&&e.jsx("p",{role:"status",children:`Принято, ожидает размещения: ${a.pendingPlacementQuantity} шт. Разместите короба на палет-сорте и обновите маршрут.`}),'+marker);
});
const rename=Object.fromEntries(graph.filter(n=>n.endsWith('.js')).map(n=>[path.basename(n),path.basename(n,'.js')+'-cabinetfbo1007.js'])),changes=[];
for(const n of graph){let s=files[n];for(const [a,b]of Object.entries(rename).sort((a,b)=>b[0].length-a[0].length))s=s.split(a).join(b);const dest=n.endsWith('.js')?'assets/'+rename[path.basename(n)]:n;
 if(n.endsWith('.js')){const ast=ts.createSourceFile(dest,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);if(ast.parseDiagnostics.length)throw Error('Invalid JS '+dest+' '+ast.parseDiagnostics.map(d=>d.messageText));}
 const p=r+'/candidate-web/'+dest;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);changes.push(dest);
}
fs.writeFileSync(r+'/web-changes.json',JSON.stringify(changes));console.log('Patched and parsed reachable graph:',changes.length,'files');
