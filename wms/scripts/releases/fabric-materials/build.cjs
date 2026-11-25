const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../../../..'),r=path.resolve(process.argv[2]||'');assert(process.argv[2]);
const ts=require(repo+'/wms/node_modules/typescript'),compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
const normalize=s=>s.replace(/\r\n/g,'\n').trim(),files=[];
// FIX: replace only source-proven modules, then apply guarded anchors to the runtime-owned roll writer.
for(const name of ['warehouse/fabric-catalog','warehouse/fabric-catalog.controller','analytics/fulfillment-groups']){
 const source='wms/apps/api/src/modules/'+name+'.ts',rel='modules/'+name+'.js';
 assert.equal(normalize(compile(cp.execFileSync('git',['show','8569bd4c:'+source],{cwd:repo,encoding:'utf8'}))),normalize(fs.readFileSync(r+'/api/'+rel,'utf8')),name+' source parity');
 fs.writeFileSync(r+'/api/'+rel,compile(fs.readFileSync(repo+'/'+source,'utf8')));files.push(rel);
}
const roll='modules/warehouse/fabric-rolls.js';fs.writeFileSync(r+'/api/'+roll,require('./patch-rolls.cjs').patchRolls(fs.readFileSync(r+'/api/'+roll,'utf8')));files.push(roll);fs.writeFileSync(r+'/api-changes.json',JSON.stringify(files));
(async()=>{
 const {build}=require(repo+'/wms/apps/web/node_modules/vite'),web=repo+'/wms/apps/web',shared='/assets/storage-volume-root-20261109.js';
 const next='assets/warehouse-fabric-materials-20261125.js',css='assets/warehouse-fabric-materials-20261125.css',legacy='assets/fabric-rolls-materials-20261125.js';
 const html=fs.readFileSync(r+'/web-base/index.html','utf8'),match=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(match);const map=JSON.parse(match[1]);assert(map.imports[shared]);
 await build({root:web,configFile:false,publicDir:false,esbuild:{jsx:'transform',jsxFactory:'__FabricReactFactory.createElement',jsxFragment:'__FabricReactFactory.Fragment',jsxInject:"import __FabricReactFactory from 'react'"},plugins:[{name:'shared-react',enforce:'pre',resolveId(id){if(id==='react')return '\0shared-react';},load(id){if(id==='\0shared-react')return `import{r as R}from'${shared}';export{R as default};export const useState=(...a)=>R.useState(...a),useEffect=(...a)=>R.useEffect(...a),useRef=(...a)=>R.useRef(...a),useMemo=(...a)=>R.useMemo(...a),useCallback=(...a)=>R.useCallback(...a);`;}}],build:{outDir:r+'/build',emptyOutDir:true,lib:{entry:web+'/src/components/warehouse/FabricWarehousePanel.tsx',formats:['es'],fileName:()=>path.basename(next)},rollupOptions:{external:[shared]}}});
 fs.mkdirSync(r+'/web/assets',{recursive:true});const js=fs.readFileSync(r+'/build/'+path.basename(next),'utf8');assert(!js.includes('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'));fs.writeFileSync(r+'/web/'+next,js);
 const styles=fs.readdirSync(r+'/build').filter(n=>n.endsWith('.css'));assert.equal(styles.length,1);fs.copyFileSync(r+'/build/'+styles[0],r+'/web/'+css);
 let cabinet=fs.readFileSync(r+'/web-base/assets/fabric-rolls-20261021.js','utf8');
 function once(s,a,b){assert.equal(s.split(a).length,2,a);return s.replace(a,b);}
 cabinet=once(cabinet,"const materials={SATIN:'Атлас',GABARDINE:'Габардин'},colors=", "const materials={SATIN:'Атлас / сатин',GABARDINE:'Габардин',...(data?.materials||{})},colors=");
 cabinet=once(cabinet,"ivory:'Айвори / шампань'};", "ivory:'Айвори / шампань',...Object.fromEntries((data?.catalogColors||[]).filter(c=>c.material===material).map(c=>[c.id,c.name]))};");
 fs.writeFileSync(r+'/web/'+legacy,cabinet);
 for(const key of Object.keys(map.imports)){
  if(map.imports[key]==='/assets/warehouse-fabric-modern-20261110.js')map.imports[key]='/'+next;
  if(map.imports[key]==='/assets/fabric-rolls-20261021.js')map.imports[key]='/'+legacy;
 }
 map.imports['/assets/warehouse-fabric-modern-20261110.js']='/'+next;map.imports['/assets/fabric-rolls-20261021.js']='/'+legacy;
 let revised=html.replace(match[1],()=>JSON.stringify(map));assert.equal(revised.split('/assets/warehouse-fabric-modern-20261110.css').length,2);revised=revised.replace('/assets/warehouse-fabric-modern-20261110.css','/'+css);fs.writeFileSync(r+'/web/index.html',revised);
 fs.writeFileSync(r+'/web-changes.json',JSON.stringify(['index.html',next,css,legacy]));console.log(JSON.stringify({api:files,web:['index.html',next,css,legacy]}));
})().catch(e=>{console.error(e);process.exitCode=1;});
