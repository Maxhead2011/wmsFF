// FIX: additive form using the existing React and authenticated transport, preserving the complete live graph.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const ts=require('../../../node_modules/typescript');
const esbuild=require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root=path.resolve(process.argv[2]),src=path.resolve(__dirname,'../../../apps/web/src');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
(async()=>{
 let html=fs.readFileSync(root+'/web-base/index.html','utf8');
 const im=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(im[1]);
 const entry=html.match(/<script type="module" crossorigin src="([^"]+)"/)[1];
 const baseline=fs.readFileSync(root+'/web-base'+entry,'utf8');
 assert.equal(entry,'/assets/kiz-client-guard-20261029.js');
 const anchor='className:"inventory-review-box__details",children:[';
 assert.equal(baseline.split(anchor).length,2);
 const added='s.canConfirmFoundUnit&&["ACTIVE","REVIEW"].includes(E.status)&&["MATCHED","MISMATCH"].includes(q.status)&&e.jsx(__InventoryFoundUnit.FoundUnitConfirmation,{accessToken:r.accessToken,boxId:q.id,onChanged:i}),';
 const tree=ts.createSourceFile('runtime.js',baseline,99,true);
 const owners=tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.getText(tree).includes(anchor));
 assert.equal(owners.length,1);assert(owners[0].getText(tree).includes('dashboard:s,session:r,onChanged:i'));
 const shims={react:'export const useState=(...args)=>x.useState(...args);','react/jsx-runtime':'export const jsx=(...a)=>e.jsx(...a),jsxs=(...a)=>e.jsxs(...a);',api:'export const confirmInventoryFoundUnit=(accessToken,id,kiz,reason,confirmed)=>z(`/inventory/boxes/${id}/found-unit`,{method:"POST",accessToken,body:{kiz,reason,confirmed}});'};
 const build=await esbuild.build({stdin:{contents:'export {FoundUnitConfirmation} from "./components/inventory/FoundUnitConfirmation";',resolveDir:src,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'__InventoryFoundUnit',jsx:'automatic',minify:true,
 plugins:[{name:'reuse-live',setup(b){b.onResolve({filter:/^(react(?:\/jsx-runtime)?)$/},a=>({path:a.path,namespace:'live'}));b.onResolve({filter:/\/lib\/api$/},()=>({path:'api',namespace:'live'}));b.onLoad({filter:/.*/,namespace:'live'},a=>({contents:shims[a.path],loader:'js'}));}}]});
 const feature=build.outputFiles[0].text;assert(!feature.includes('createRoot'));
 const injected=baseline.replace(anchor,anchor+added);
 assert.equal(injected.replace(anchor+added,anchor),baseline);
 const code=injected+'\n'+feature;
 assert.equal(ts.createSourceFile('candidate.js',code,99,true).parseDiagnostics.length,0);
 const next='/assets/inventory-found-unit-20261030.js';
 for(const key of Object.keys(map.imports))if(map.imports[key]===entry)map.imports[key]=next;
 map.imports[entry]=next;
 html=html.replace(im[1],JSON.stringify(map)).replace(`src="${entry}"`,`src="${next}"`);
 const css=fs.readFileSync(src+'/components/inventory/inventory.css','utf8');
 const cssStart=css.indexOf('.inventory-found-unit');assert(cssStart>=0);
 html=html.replace('</head>','<style>'+css.slice(cssStart)+'</style></head>');
 fs.mkdirSync(root+'/web-payload/assets',{recursive:true});
 fs.writeFileSync(root+'/web-payload'+next,code);fs.writeFileSync(root+'/web-payload/index.html',html);
 fs.writeFileSync(root+'/web-proof.json',JSON.stringify({baseSha256:sha(baseline),sha256:sha(code),preservedRuntime:true,owner:owners[0].name.text},null,2));
 console.log('Additive web form verified');
})().catch(e=>{console.error(e);process.exit(1)});
