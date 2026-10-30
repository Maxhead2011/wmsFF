// FIX: exact overlay on the verified live release; never replace whole shared services.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=path.resolve(process.argv[2]),w=path.resolve(__dirname,'../../..');
const read=p=>fs.readFileSync(p,'utf8'),save=(p,s)=>{p=root+'/'+p;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
let n='modules/administration/fbo-picker-statistics.js';
save('api-payload/'+n,ts.transpileModule(read(w+'/apps/api/src/'+n.replace('.js','.ts')),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
n='modules/administration/administration.service.js';
save('api-payload/'+n,once(read(root+'/api-live/'+n),'            pickerStatistics: {','            fboPickerStatistics: await require("./fbo-picker-statistics").fboPickerStatistics(this.prisma,user,statisticsPeriod),\n            pickerStatistics: {'));
n='modules/client-requests/ozon-fbo-import.service.js';let s=read(root+'/api-live/'+n);
s=once(s,'take: 100, select: { id: true, number: true','take: 100, select: { id: true, clientId: true, number: true');
s=once(s,'        return rows.map(r => ({ id: r.id,','        const stores = await require("../clients/request-store-context").requestStoreContexts(this.db,rows);\n        return rows.map(r => ({ ...stores.get(r.id), id: r.id,');save('api-payload/'+n,s);
function bundle(file,name,react){const source=read(w+'/apps/web/src/'+file),ast=ts.createSourceFile(file,source,99,true,ts.ScriptKind.TSX);const body=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n');return esbuild.buildSync({stdin:{contents:body,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:name,minify:true,jsx:'transform',jsxFactory:react+'.createElement'}).outputFiles[0].text;}
let html=read(root+'/web-base/index.html'),match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);
function patch(old,next,fn){save('web-payload/assets/'+next,fn(read(root+'/web-base/assets/'+old)));for(const k of Object.keys(map.imports))if(map.imports[k]==='/assets/'+old)map.imports[k]='/assets/'+next;map.imports['/assets/'+old]='/assets/'+next;}
patch('ozon-label-control-20261030.js','fbo-stores-ozon-20261030.js',s=>{
 s=once(s,'o.createElement("div",{className:"ozfbo-row-client"},o.createElement("strong",null,i.clientCode)," ",i.clientName??"\\u2014"),','o.createElement("div",{className:"ozfbo-row-client"},o.createElement("strong",null,i.clientCode)," ",i.clientName??"\\u2014"),o.createElement(__FboStore.OzonStoreLabel,{request:i}),');
 s=once(s,'o.createElement("p",{className:"ozfbo-workspace-name"},t.title),','o.createElement("p",{className:"ozfbo-workspace-name"},t.title),o.createElement(__FboStore.OzonStoreLabel,{request:t}),');
 return s+'\n'+bundle('components/ozon-fbo/OzonStoreLabel.tsx','__FboStore','h');
});
patch('admin-tiles-20261019-11.js','fbo-productivity-20261030.js',s=>once(s,'t?e.jsx(Qs,{statistics:t.pickerStatistics}):null,','t?e.jsx(Qs,{statistics:t.pickerStatistics}):null,t?.fboPickerStatistics?e.jsx(__FboStatistics.FboPickerStatistics,{statistics:t.fboPickerStatistics,period:t.pickerStatistics.period.label}):null,')+'\n'+bundle('components/monitoring/FboPickerStatistics.tsx','__FboStatistics','a'));
save('web-payload/index.html',html.replace(match[1],JSON.stringify(map)));
// TEST: the HTML application entry remains byte-for-byte the same (no second root).
assert.equal(read(root+'/web-payload/index.html').match(/<script type="module" crossorigin src="([^"]+)"/)[1],html.match(/<script type="module" crossorigin src="([^"]+)"/)[1]);
for(const dir of ['api-payload','web-payload'])for(const f of fs.readdirSync(root+'/'+dir,{recursive:true}))if(f.endsWith('.js'))assert.equal(ts.createSourceFile(f,read(root+'/'+dir+'/'+f),99,true).parseDiagnostics.length,0,f);
console.log('Prepared API3/web3; original application entry retained');
