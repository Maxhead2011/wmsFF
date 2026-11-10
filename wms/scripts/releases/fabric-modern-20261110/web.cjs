'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {build}=require('../../../apps/web/node_modules/vite');
async function main(){
 const web=path.resolve(__dirname,'../../../apps/web');
 const root=path.resolve(process.argv[2]),base=path.join(root,'web-base'),out=path.join(root,'web-payload'),shared='/assets/storage-volume-root-20261109.js';
 const next='/assets/warehouse-fabric-modern-20261110.js',css='/assets/warehouse-fabric-modern-20261110.css';
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8'),match=html.match(/<script type="importmap">(.*?)<\/script>/s);assert(match);
 const map=JSON.parse(match[1]);assert(map.imports[shared], 'Existing React alias required');assert(!map.imports['/assets/warehouse-fabric-20261109.js'],'Already updated');
 // FIX: immutable component URL, forwarding to the existing application's React.
 await build({root:web,configFile:false,publicDir:false,esbuild:{jsx:'transform',jsxFactory:'__FabricReactFactory.createElement',jsxFragment:'__FabricReactFactory.Fragment',jsxInject:"import __FabricReactFactory from 'react'"},plugins:[{name:'shared-react',enforce:'pre',resolveId(id){if(id==='react')return '\0shared-react'},load(id){if(id==='\0shared-react')return `import{r as R}from'${shared}';export{R as default};export const useState=(...a)=>R.useState(...a),useEffect=(...a)=>R.useEffect(...a),useRef=(...a)=>R.useRef(...a),useMemo=(...a)=>R.useMemo(...a),useCallback=(...a)=>R.useCallback(...a);`}}],build:{outDir:path.join(root,'build'),emptyOutDir:true,lib:{entry:path.join(web,'src/components/warehouse/FabricWarehousePanel.tsx'),formats:['es'],fileName:()=>path.basename(next)},rollupOptions:{external:[shared]}}});
 fs.mkdirSync(path.join(out,'assets'),{recursive:true});const js=fs.readFileSync(path.join(root,'build',path.basename(next)),'utf8');assert(!js.includes('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'));
 map.imports['/assets/warehouse-fabric-20261109.js']=next;
 const revised=html.replace(match[1],()=>JSON.stringify(map)).replace('href="/assets/warehouse-fabric-20261109.css"',`href="${css}"`);assert.notEqual(html,revised);assert(revised.includes(`href="${css}"`));
 fs.writeFileSync(path.join(out,'index.html'),revised);fs.writeFileSync(path.join(out,next),js);
 const builtCss=fs.readdirSync(path.join(root,'build')).filter(n=>n.endsWith('.css'));assert.equal(builtCss.length,1);fs.copyFileSync(path.join(root,'build',builtCss[0]),path.join(out,css));
 fs.writeFileSync(path.join(root,'web-changes.json'),JSON.stringify(['index.html',next.slice(1),css.slice(1)]));console.log('Exact web3 overlay; existing root and React retained.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
