const assert=require('node:assert/strict'),fs=require('node:fs');
const {parse,verify}=require('./pallet-sorting-artifacts.cjs');
// FIX: allow reviewed source changes and new hashed bundles, preserving all previous artifacts.
function checkWeb(before,after,meta){
 const apk='downloads/logoff-tsd-sorting-admin-164.apk';
 const allowed=['index.html','downloads/logoff-tsd.apk','downloads/logoff-tsd.json'];
 assert.equal(meta.versionCode,164);assert.equal(after.get(apk),meta.sha256);assert.equal(after.get('downloads/logoff-tsd.apk'),meta.sha256);
 for(const [p,h] of before){assert(after.has(p),'removed '+p);if(!allowed.includes(p))assert.equal(after.get(p),h,'changed '+p);}
 for(const p of after.keys())if(!before.has(p))assert(p.startsWith('assets/')||p===apk,'unexpected '+p);
 assert.notEqual(before.get('index.html'),after.get('index.html'));
}
module.exports={checkWeb};
if(require.main===module){
 const b=process.argv[2],meta=JSON.parse(fs.readFileSync(process.argv[3]));
 const read=(n,p)=>parse(fs.readFileSync(`${b}/${n}.sha256`,'utf8'),p);
 verify(read('api-before','/app/apps/api/'),read('api-after','/app/apps/api/'),['inventory/pallet-sorting.service','stock/sorting-written-off-recovery'].flatMap(p=>['src/modules/'+p+'.ts','dist/modules/'+p+'.js']));
 verify(read('web-src-before','src/'),read('web-src-after','src/'),['components/inventory/PalletSortingPanel.tsx','lib/pallet-sorting-api.ts']);
 checkWeb(read('web-before','/usr/share/nginx/html/'),read('web-after','/usr/share/nginx/html/'),meta);
 for(const k of ['api','web'])assert.deepEqual(JSON.parse(fs.readFileSync(`${b}/${k}-config-before.json`)),JSON.parse(fs.readFileSync(`${b}/${k}-config-after.json`)));
 console.log('ONLY_APPROVED_SORTING_CHANGES_AND_APK_164');
}
