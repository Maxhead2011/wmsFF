const assert=require('node:assert/strict'),fs=require('node:fs');
const {parse,verify}=require('./pallet-sorting-artifacts.cjs');
const modules=['modules/administration/administration.controller','modules/administration/administration.service','modules/administration/administration-internal-api.service','modules/tsd/tsd-device.controller','modules/tsd/tsd-device.service','modules/tsd/tsd-monitor-messages'];
const webSources=['lib/api.ts','components/monitoring/TsdMonitoringPanel.tsx','components/monitoring/tsd-monitoring.css','components/monitoring/TsdMessagesDialog.tsx','components/monitoring/TsdMessagesDialog.spec.tsx'];
// TEST: fail closed on any unrelated source, asset, configuration or APK drift.
function checkWeb(before,after,meta){
 const mutable=['index.html','downloads/logoff-tsd.apk','downloads/logoff-tsd.json'];
 const immutable='downloads/logoff-tsd-messages-162.apk';
 assert(!before.has(immutable));
 for(const [p,h] of before){assert(after.has(p),`removed ${p}`);if(!mutable.includes(p))assert.equal(after.get(p),h,`changed ${p}`);}
 for(const p of after.keys())if(!before.has(p))assert(p.startsWith('assets/')||p===immutable,`unexpected ${p}`);
 assert.notEqual(before.get('index.html'),after.get('index.html'));
 assert.equal(meta.versionCode,162);assert.equal(meta.versionName,'0.1.163-messages');
 assert.equal(meta.apkUrl,'https://wms.logoff.pro/'+immutable);assert.match(meta.sha256,/^[a-f0-9]{64}$/);
 assert.equal(after.get(immutable),meta.sha256);assert.equal(after.get('downloads/logoff-tsd.apk'),meta.sha256);
}
module.exports={checkWeb,modules,webSources};
if(require.main===module){
 const b=process.argv[2],meta=JSON.parse(fs.readFileSync(process.argv[3]));
 const read=(name,prefix)=>parse(fs.readFileSync(`${b}/${name}.sha256`,'utf8'),prefix);
 verify(read('api-before','/app/apps/api/'),read('api-after','/app/apps/api/'),modules.flatMap(p=>['src/'+p+'.ts','dist/'+p+'.js']));
 verify(read('web-source-before','src/'),read('web-source-after','src/'),webSources);
 checkWeb(read('web-before','/usr/share/nginx/html/'),read('web-after','/usr/share/nginx/html/'),meta);
 for(const kind of ['api','web'])assert.deepEqual(JSON.parse(fs.readFileSync(`${b}/${kind}-config-before.json`)),JSON.parse(fs.readFileSync(`${b}/${kind}-config-after.json`)));
 console.log('ONLY_TSD_MESSAGES_AND_LOGOFF_162_CHANNEL_CHANGED');
}
