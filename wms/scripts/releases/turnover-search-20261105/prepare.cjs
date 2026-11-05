const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),base=path.join(root,'web-base'),out=path.join(root,'web-payload');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8'),m=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(m[1]);
const entry=html.match(/<script type="module" crossorigin src="([^"]+)"/)[1],next='/assets/turnover-selected-product-20261105.js';
assert.equal(entry,'/assets/tsd-download-253-20261103.js');assert.equal(map.imports['/assets/admin-tiles-20261019-0.js'],entry);
let s=fs.readFileSync(path.join(base,entry),'utf8');const tree=ts.createSourceFile('entry.js',s,99,true,ts.ScriptKind.JS);
const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='t8');assert(fn);let f=fn.getText(tree);
function once(a,b){assert.equal(f.split(a).length,2,a);f=f.replace(a,()=>b);}
// FIX: exact delta in the deployed component; preserve every unrelated runtime function.
once('const turnoverGeneration=x.useRef(0);','const turnoverGeneration=x.useRef(0);const [productFilter,setProductFilter]=x.useState(null);');
once('const pe={clientId:b,search:R.trim()||void 0,','const filterSkuId=productFilter?.label===R&&productFilter.clientId===b?productFilter.skuId:void 0;const pe={clientId:b,skuId:filterSkuId||void 0,search:filterSkuId?void 0:R.trim()||void 0,');
once('C(pe.label??pe.value),g(pe.value),','C(pe.label??pe.value),setProductFilter({skuId:Bn(pe,"skuId"),label:pe.label??pe.value,clientId:b}),g(pe.value),');
s=s.slice(0,fn.getStart(tree))+f+s.slice(fn.end);assert.equal(ts.createSourceFile('patched.js',s,99,true,ts.ScriptKind.JS).parseDiagnostics.length,0);
fs.mkdirSync(path.join(out,'assets'),{recursive:true});fs.writeFileSync(path.join(out,next),s);
for(const k of Object.keys(map.imports))if(map.imports[k]===entry)map.imports[k]=next;map.imports[entry]=next;
let h=html.replace(m[1],()=>JSON.stringify(map)).replace('src="'+entry+'"','src="'+next+'"');
assert.equal((h.match(new RegExp('src="'+next+'"','g'))||[]).length,1);assert.equal(map.imports['/assets/admin-tiles-20261019-0.js'],next);
fs.writeFileSync(path.join(out,'index.html'),h);fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(['index.html',next.slice(1)]));
console.log('Exact component delta; shared runtime and entry map to one module');
