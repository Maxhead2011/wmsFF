// FIX: amend only compact-menu navigation and add a scoped layout marker to the current live module.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),oldName='fbs-compact-menu-20261024.js',newName='fbs-seven-menu-20261024.js';
const original=fs.readFileSync(path.join(root,'web-base/assets',oldName),'utf8'),ast=ts.createSourceFile(oldName,original,99,true,1);
const changed=['ci','__fbsCompactGroup','__fbsCompactViews','__FbsCompactSubnav'];let next=original;
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Single patch anchor: '+a);return s.replace(a,b)};
for(const fn of ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&changed.includes(n.name?.text)).reverse()){
 let s=fn.getText(ast);
 if(fn.name.text==='ci') {s=once(s,'"data-marketplace":a,role:"tablist"','"data-marketplace":a,"data-menu-layout":a==="WILDBERRIES"?"seven":void 0,role:"tablist"');s=once(s,'__FbsCompactSubnav,{view:p','__FbsCompactSubnav,{marketplace:a,view:p');}
 if(fn.name.text==='__fbsCompactGroup')s=once(s,"view==='reshipment'?","['reshipment','penalties'].includes(view)?");
 if(fn.name.text==='__fbsCompactViews'){s=once(s,"'pricing','reshipment']","'pricing','reshipment','penalties']");s=once(s,'Контроль автоотмены и повторный довоз WB.','Контроль автоотмены, повторный довоз и штрафы FBS.');}
 if(fn.name.text==='__FbsCompactSubnav'){s=once(s,'{view,setView','{marketplace,view,setView');s=once(s,"['reshipment','Повторный довоз']","['reshipment','Повторный довоз'],...(marketplace==='WILDBERRIES'?[['penalties','Штрафы по FBS']]:[])");}
 next=next.slice(0,fn.getStart(ast))+s+next.slice(fn.end);
}
const updated=ts.createSourceFile(newName,next,99,true,1);assert.equal(updated.parseDiagnostics.length,0);
const others=tree=>tree.statements.filter(n=>!ts.isFunctionDeclaration(n)||!changed.includes(n.name?.text)).map(n=>n.getText(tree));
assert.deepEqual(others(ast),others(updated));assert.equal(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&changed.includes(n.name?.text)).length,4);
const payload=path.join(root,'payload');fs.mkdirSync(path.join(payload,'assets'),{recursive:true});fs.writeFileSync(path.join(payload,'assets',newName),next);
const cssSource=fs.readFileSync(path.resolve(__dirname,'../../../apps/web/src/components/fbs/fbs.css'),'utf8');const marker='/* FIX: seven WB sections:';assert(cssSource.includes(marker));fs.writeFileSync(path.join(payload,'assets/fbs-seven-menu-20261024.css'),cssSource.slice(cssSource.indexOf(marker)));
const html=fs.readFileSync(path.join(root,'web-base/index.html'),'utf8'),start=html.indexOf('<script type="importmap">')+'<script type="importmap">'.length,end=html.indexOf('</script>',start);assert(start>24&&end>start);const map=JSON.parse(html.slice(start,end));let count=0;for(const key of Object.keys(map.imports)){if(map.imports[key]==='/assets/'+oldName){map.imports[key]='/assets/'+newName;count++;}}assert(count>=1);map.imports['/assets/'+oldName]='/assets/'+newName;
fs.writeFileSync(path.join(payload,'index.html'),(html.slice(0,start)+JSON.stringify(map)+html.slice(end)).replace('</head>','<link rel="stylesheet" href="/assets/fbs-seven-menu-20261024.css">\n</head>'));
const names=['index.html','assets/'+newName,'assets/fbs-seven-menu-20261024.css'];const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
fs.writeFileSync(path.join(root,'patch-proof.json'),JSON.stringify({changedFunctions:changed,otherStatementsPreserved:true,baseModuleSha256:hash(original),candidateHashes:Object.fromEntries(names.map(n=>[n,hash(fs.readFileSync(path.join(payload,n)))]))},null,2));console.log('Verified: only 4 navigation functions changed; all other top-level statements retained.');
