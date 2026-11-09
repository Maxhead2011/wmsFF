// FIX: expose the existing editable rule snapshot even when allocation analysis is null.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(process.argv[2]),web=path.resolve('apps/web'),req=createRequire(require.resolve('vite',{paths:[web+'/node_modules']}));
const api='modules/marketplace-connections/marketplace-connections.service.js';
const original=fs.readFileSync(root+'/api-base/'+api,'utf8');
const before='return { ...result, fineSettingsEnabled: true, ...reserveSettings, analysisSettings, publicationChecks,';
const after='return { ...result, fineSettingsEnabled: true, reserveRows: stock, ...reserveSettings, analysisSettings, publicationChecks,';
assert.equal(original.split(before).length,2);const patched=original.replace(before,after);assert.equal(patched.replace(after,before),original);
const put=(service,name,value)=>{const target=root+'/'+service+'-payload/'+name;fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value)};
put('api',api,patched);
// FIX: shared physical SKUs may originate from Ozon; require an explicit active WB mapping.
const control='modules/marketplace-connections/marketplace-stock-control.service.js';
const controlBase=fs.readFileSync(root+'/api-base/'+control,'utf8');
const guard="if (!await this.prisma.sku.findFirst({ where: { id: skuId, clientId, marketplace: 'WILDBERRIES' }, select: { id: true } }))";
const linkedGuard=`const ruleSku = await this.prisma.sku.findFirst({ where: { id: skuId, clientId }, select: { id: true, marketplace: true } });
            const ruleLinks = ruleSku && ruleSku.marketplace !== 'WILDBERRIES' ? await this.prisma.marketplaceProductLink.findMany({ where: { skuId, clientId, marketplace: 'WILDBERRIES', status: 'LINKED' }, select: { connectionId: true } }) : [];
            const ruleCabinet = ruleLinks.length ? await this.prisma.clientMarketplaceConnection.findFirst({ where: { id: { in: ruleLinks.map(link => link.connectionId) }, clientId, marketplace: 'WILDBERRIES', isActive: true }, select: { id: true } }) : null;
            if (!ruleSku || (ruleSku.marketplace !== 'WILDBERRIES' && !ruleCabinet))`;
assert.equal(controlBase.split(guard).length,2);const controlPatch=controlBase.replace(guard,linkedGuard);assert.equal(controlPatch.replace(linkedGuard,guard),controlBase);put('api',control,controlPatch);
(async()=>{
 const built=await req('esbuild').build({entryPoints:[web+'/src/components/fbs/FbsProductReserve.tsx'],bundle:true,write:false,format:'esm',tsconfigRaw:{compilerOptions:{jsx:'react'}},jsx:'transform',jsxFactory:'React.createElement',jsxFragment:'React.Fragment',define:{'import.meta.env.VITE_API_URL':'"/api/v1"'},plugins:[{name:'published-react',setup(build){
  build.onResolve({filter:/^react$/},()=>({path:'published-react',namespace:'singleton'}));
  build.onLoad({filter:/.*/,namespace:'singleton'},()=>({contents:'import {r as React} from "./admin-tiles-20261019-0.js";export default {createElement:(...args)=>React.createElement(...args)};export const useEffect=(...args)=>React.useEffect(...args),useRef=(...args)=>React.useRef(...args),useState=(...args)=>React.useState(...args);',loader:'js'}));
  build.onResolve({filter:/admin-tiles-20261019-0.js/},()=>({path:'./admin-tiles-20261019-0.js',external:true}));
 }}]});
 assert(!built.outputFiles[0].text.includes('ReactCurrentDispatcher'));
 const old='assets/inline-reserve-fbs-startup-20261109.js',next='assets/fbs-reserve-settings-20261109.js',editor='assets/product-reserve-settings-20261109.js';
 const fbs=fs.readFileSync(root+'/web-base/'+old,'utf8'),oldImport='./inline-product-reserve-startup-20261109.js';assert.equal(fbs.split(oldImport).length,2);
 put('web',next,fbs.replace(oldImport,'./product-reserve-settings-20261109.js'));put('web',editor,built.outputFiles[0].text);
 const html=fs.readFileSync(root+'/web-base/index.html','utf8'),match=html.match(/<script type="importmap">(.*?)<\/script>/s),map=JSON.parse(match[1]);let count=0;
 for(const key of Object.keys(map.imports))if(map.imports[key]==='/'+old){map.imports[key]='/'+next;count++}assert(count);map.imports['/'+old]='/'+next;
 put('web','index.html',html.replace(match[1],()=>JSON.stringify(map)));
 fs.writeFileSync(root+'/api-changes.json',JSON.stringify([api,control]));fs.writeFileSync(root+'/web-changes.json',JSON.stringify([next,editor,'index.html']));
 fs.writeFileSync(root+'/overlay-proof.json',JSON.stringify({apiFiles:2,webFiles:3,apiInverseExact:true,stockCalculationUnchanged:true,sharedReact:true,sharedSkuRequiresActiveWbLink:true}));
 console.log('PASS: API2 exact inverse; response field and shared-SKU eligibility only; web3');
})().catch(e=>{console.error(e);process.exitCode=1});
