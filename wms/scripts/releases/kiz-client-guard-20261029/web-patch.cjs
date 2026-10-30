// FIX: keep the current published graph and replace only the three reviewed KIZ/receipt components.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('../../../node_modules/typescript');
const esbuild = require('module').createRequire(require.resolve('../../../apps/web/node_modules/vite/package.json'))('esbuild');
const root = path.resolve(process.argv[2]);
const src = path.resolve(__dirname, '../../../apps/web/src');
const output = root + '/web/payload';
const artifact = 'kiz-client-guard-20261029.js';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ast = (s, extension = 'tsx') => ts.createSourceFile('module.' + extension, s, 99, true);
function declaration(s, name, extension = 'tsx') {
  const tree = ast(s, extension);
  const found = tree.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.equal(found.length, 1, 'Expected one function: ' + name);
  return { node: found[0], tree, text: found[0].getText(tree), start: found[0].getStart(tree), end: found[0].end };
}

(async () => {
  let html = fs.readFileSync(root + '/web-base/index.html', 'utf8');
  const mapMatch = html.match(/<script type="importmap">(.*?)<\/script>/s);
  assert(mapMatch, 'Existing import map is required');
  const map = JSON.parse(mapMatch[1]);
  const entry = html.match(/<script type="module" crossorigin src="([^"]+)"/)[1];
  assert.equal(map.imports['/assets/admin-tiles-20261019-0.js'], entry, 'Entry and shared runtime must be one module');
  const baseline = fs.readFileSync(root + '/web-base' + entry, 'utf8');
  assert(!baseline.includes('var __ClientKizFeatures='), 'Patch is already installed');
  const oldFunctions = Object.fromEntries(['LC', 'f4', 'p4'].map(n => [n, declaration(baseline, n, 'js')]));
  const reviewedHashes = { LC:'b0d57f52bd516ca00f80ce1a7b815defadff874540273a4da54eee144aeb83a0',
    p4:'4a3e9fd66ec3a68aa1e4148cefc8d2057d48d70c77d38e962938b77782ad6f66',f4:'d1a9355f2ce49bdde64b9807e8935ff28ce6aad2214364d83e3e92059ef0e6ec' };
  for(const [name,fn] of Object.entries(oldFunctions))assert.equal(sha(fn.text),reviewedHashes[name],'Published target changed; review before replacing '+name);
  assert(oldFunctions.LC.text.includes('Направления приёмок ФБС / ФБО'));
  assert(oldFunctions.LC.text.includes('e.jsx(LD,') && oldFunctions.LC.text.includes('e.jsx(zD,'));
  assert(oldFunctions.f4.text.includes('__MainFeatures.reviewWeek'));
  assert(oldFunctions.p4.text.includes('__MainFeatures.KizReviewCard'));
  // The helpers are the live runtime's versions, including later unrelated receipt work.
  for (const helper of ['LD','zD','_h','$C','xv','BD','UD','jl','Lt','Pr','Rt','HP','VP','KP','ZP','GP','$P','Oo','g0','XP','uT','hT']) declaration(baseline, helper, 'js');

  const receiptSource = fs.readFileSync(src + '/components/warehouse/OnlineReceiptPanel.tsx', 'utf8');
  const receiptFunction = declaration(receiptSource, 'OnlineReceiptPanel');
  const receiptImports = receiptFunction.tree.statements.filter(ts.isImportDeclaration).map(n => n.getText(receiptFunction.tree)).join('\n');
  const receipt = receiptImports + '\n' + receiptFunction.text + '\n' +
    'const BoxDetails=(p)=>e.jsx(LD,p),DeletedBoxesList=(p)=>e.jsx(zD,p),Stat=(p)=>e.jsx(_h,p);' +
    'const statusLabel=(...a)=>$C(...a),formatDateTime=(...a)=>xv(...a),formatBatchDate=(...a)=>BD(...a),canUse=(...a)=>UD(...a);';
  const apiSource = fs.readFileSync(src + '/lib/api.ts', 'utf8');
  const safeApiNames = ['request','responseError','addOnlineReceiptItem','updateOnlineReceiptItem','queueReceiptKizReview'];
  const apiBindings = {
    closeAllOnlineReceiptBoxes:'HP',closeOnlineReceiptBox:'VP',deleteOnlineReceiptBox:'KP',deleteOnlineReceiptItem:'ZP',
    finishOnlineReceipt:'GP',fetchClients:'Rt',fetchOnlineReceipts:'$P',fetchSkus:'Oo',
    openOnlineReceiptBox:'g0',restoreOnlineReceiptBox:'XP',fetchKizReviewQueue:'uT',decideKizReview:'hT',
  };
  const apiShim = 'const API_BASE_URL=_p;\n' + safeApiNames.map(n => declaration(apiSource,n).text).join('\n') + '\n' +
    Object.entries(apiBindings).map(([name,alias]) => `export const ${name}=(...args)=>${alias}(...args);`).join('\n');
  const shims = {
    'react': 'export const useState=(...a)=>x.useState(...a),useEffect=(...a)=>x.useEffect(...a),useMemo=(...a)=>x.useMemo(...a),useRef=(...a)=>x.useRef(...a),useCallback=(...a)=>x.useCallback(...a);',
    'react/jsx-runtime': 'export const jsx=(...a)=>e.jsx(...a),jsxs=(...a)=>e.jsxs(...a),Fragment=Symbol.for("react.fragment");',
    'lucide-react': 'export const CheckCircle2=p=>e.jsx(xt,p),Edit3=p=>e.jsx(tS,p),PackageOpen=p=>e.jsx(Jw,p),RefreshCw=p=>e.jsx(Ze,p),RotateCcw=p=>e.jsx(_l,p),Search=p=>e.jsx(Gt,p),Trash2=p=>e.jsx(Dt,p),Unlock=p=>e.jsx(zA,p);',
    'ConfirmDialog': 'export const ConfirmDialog=p=>e.jsx(jl,p);',
    'rememberedClient': 'export const useRememberedClientId=(...a)=>Lt(...a),validRememberedClientId=(...a)=>Pr(...a);',
    'ReceiptDirectionsPanel': 'export const ReceiptDirectionsPanel=p=>e.jsx(__ReceiptDirections.ReceiptDirectionsPanel,p);',
    'KizFoundPanel': 'export const KizFoundPanel=p=>e.jsx(__FoundKiz.KizFoundPanel,p);',
    'api': apiShim,
  };
  const built = await esbuild.build({
    stdin: { contents: 'export {OnlineReceiptPanel} from "./components/warehouse/OnlineReceiptPanel";export {KizReviewQueuePanel,KizReviewCard} from "./components/kiz/KizReviewQueuePanel";', resolveDir: src, loader: 'tsx' },
    bundle:true,write:false,format:'iife',globalName:'__ClientKizFeatures',jsx:'automatic',minify:true,
    define:{'import.meta.env.VITE_KIZ_CLIENT_GUARD_ENABLED':'"true"','import.meta.env.VITE_KIZ_FOUND_REVIEW_ENABLED':'"true"'},
    plugins:[{name:'current-runtime-bindings',setup(build){
      build.onResolve({filter:/^(react(?:\/jsx-runtime)?|lucide-react)$/},a=>({path:a.path,namespace:'runtime'}));
      build.onResolve({filter:/\/(api|rememberedClient|ConfirmDialog|ReceiptDirectionsPanel|KizFoundPanel)$/},a=>({path:path.basename(a.path),namespace:'runtime'}));
      build.onLoad({filter:/.*/,namespace:'runtime'},a=>({contents:shims[a.path],loader:'tsx',resolveDir:src}));
      build.onLoad({filter:/OnlineReceiptPanel\.tsx$/},()=>({contents:receipt,loader:'tsx',resolveDir:src+'/components/warehouse'}));
    }}],
  });
  const feature = built.outputFiles[0].text;
  assert(!feature.includes('react.production') && !feature.includes('createRoot'), 'Must use the existing React runtime');
  let patched = baseline;
  const names = {LC:'OnlineReceiptPanel',f4:'KizReviewQueuePanel',p4:'KizReviewCard'};
  for (const [name, fn] of Object.entries(oldFunctions).sort((a,b)=>b[1].start-a[1].start)) {
    patched = patched.slice(0,fn.start) + `function ${name}(props){return e.jsx(__ClientKizFeatures.${names[name]},props)}` + patched.slice(fn.end);
  }
  // TEST: no existing component, transport, or shared feature bundle changes outside the exact wrappers.
  let recovered = patched;
  const replacements = Object.entries(oldFunctions).map(([name,fn])=>({name,fn,now:declaration(recovered,name,'js')})).sort((a,b)=>b.now.start-a.now.start);
  for(const {fn,now} of replacements) recovered=recovered.slice(0,now.start)+fn.text+recovered.slice(now.end);
  assert.equal(recovered,baseline,'Unrelated published runtime changed');
  const insertion = declaration(patched,'LC','js').start;
  patched = patched.slice(0,insertion) + feature + '\n' + patched.slice(insertion);
  assert.equal(ast(patched,'js').parseDiagnostics.length,0,'Generated host syntax');
  const next='/assets/'+artifact;
  for(const key of Object.keys(map.imports))if(map.imports[key]===entry)map.imports[key]=next;
  map.imports[entry]=next;
  html=html.replace(mapMatch[1],JSON.stringify(map)).replace(`src="${entry}"`,`src="${next}"`);
  assert.equal((html.match(new RegExp(`src="${next}"`,'g'))??[]).length,1,'One application entry');
  fs.mkdirSync(output+'/assets',{recursive:true});
  fs.writeFileSync(output+'/assets/'+artifact,patched);
  fs.writeFileSync(output+'/index.html',html);
  const manifest={baseEntry:entry,baseSha256:sha(baseline),artifact:'assets/'+artifact,sha256:sha(patched),changedFunctions:Object.keys(names),preservedRuntime:true,featuresBytes:Buffer.byteLength(feature),changes:['index.html','assets/'+artifact]};
  fs.writeFileSync(root+'/web/manifest.json',JSON.stringify(manifest,null,2));
  fs.writeFileSync(root+'/web-changes.json',JSON.stringify(manifest.changes));
  console.log(JSON.stringify(manifest,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
