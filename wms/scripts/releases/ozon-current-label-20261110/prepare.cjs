// FIX: two-file delta on the verified running API; never replace the full service.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),dir='modules/marketplace-connections/';
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)};
const base=fs.readFileSync(root+'/api-base/'+dir+'marketplace-connections.service.js','utf8');
const anchor='async function marketplaceBinary(url, init) {';
const insertion='\n    // FIX: current Ozon label API, own installation only.\n    if (url === "https://api-seller.ozon.ru/v2/posting/fbs/package-label" && process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED === "true")\n        return require("./ozon-current-label").currentOzonLabel(init, marketplaceJson);';
assert.equal(base.split(anchor).length,2);
const next=base.replace(anchor,anchor+insertion);assert.equal(next.replace(insertion,''),base);
write(root+'/api-payload/'+dir+'marketplace-connections.service.js',next);
const helper=ts.transpileModule(fs.readFileSync('apps/api/src/'+dir+'ozon-current-label.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
write(root+'/api-payload/'+dir+'ozon-current-label.js',helper);
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});fs.cpSync(root+'/api-payload',root+'/api-candidate',{recursive:true});
write(root+'/api-changes.json',JSON.stringify([dir+'marketplace-connections.service.js',dir+'ozon-current-label.js']));
write(root+'/web-changes.json','[]');write(root+'/browser-proof.json',JSON.stringify({webUnchanged:true}));
write(root+'/overlay-proof.json',JSON.stringify({apiFiles:2,webFiles:0,inverse:true}));
console.log('API2 prepared; inverse byte equality passed');
