const assert=require('node:assert/strict'),fs=require('node:fs');
const {parse,verify}=require('./pallet-sorting-artifacts.cjs');
const modules=['inventory/dto/pallet-sorting.dto','inventory/pallet-sorting.service','stock/stock-operations.service','stock/sorting-written-off-recovery'];
// TEST: only the approved API modules and LOGOFF APK channel can change.
function checkWeb(before,after,meta){
 const added='downloads/logoff-tsd-kiz-recovery-163.apk';
 assert(!before.has(added));
 verify(before,after,['downloads/logoff-tsd.apk','downloads/logoff-tsd.json',added]);
 assert.equal(meta.versionCode,163);assert.equal(meta.versionName,'0.1.164-kiz-recovery');
 assert.equal(meta.apkUrl,'https://wms.logoff.pro/'+added);assert.match(meta.sha256,/^[a-f0-9]{64}$/);
 assert.equal(after.get(added),meta.sha256);assert.equal(after.get('downloads/logoff-tsd.apk'),meta.sha256);
}
module.exports={checkWeb};
if(require.main===module){
 const b=process.argv[2],meta=JSON.parse(fs.readFileSync(process.argv[3]));
 const read=(n,p)=>parse(fs.readFileSync(`${b}/${n}.sha256`,'utf8'),p);
 verify(read('api-before','/app/apps/api/'),read('api-after','/app/apps/api/'),modules.flatMap(p=>['src/modules/'+p+'.ts','dist/modules/'+p+'.js']));
 checkWeb(read('web-before','/usr/share/nginx/html/'),read('web-after','/usr/share/nginx/html/'),meta);
 for(const k of ['api','web'])assert.deepEqual(JSON.parse(fs.readFileSync(`${b}/${k}-config-before.json`)),JSON.parse(fs.readFileSync(`${b}/${k}-config-after.json`)));
 console.log('ONLY_RECOVERY_MODULES_AND_LOGOFF_163_CHANGED');
}
