const {test}=require('node:test'),assert=require('node:assert/strict');
const {checkWeb}=require('./tsd-messages-artifacts.cjs');
const meta={versionCode:162,versionName:'0.1.163-messages',apkUrl:'https://wms.logoff.pro/downloads/logoff-tsd-messages-162.apk',sha256:'a'.repeat(64)};
function maps(){const before=new Map([['index.html','old'],['assets/old.js','same'],['downloads/logoff-tsd.apk','old'],['downloads/logoff-tsd.json','old'],['downloads/ff.apk','sold']]);const after=new Map(before);after.set('index.html','new');after.set('downloads/logoff-tsd.apk',meta.sha256);after.set('downloads/logoff-tsd.json','new');after.set('downloads/logoff-tsd-messages-162.apk',meta.sha256);after.set('assets/new.js','new');return {before,after};}
test('accepts new UI bundles and exact APK with all old assets retained',()=>{const {before,after}=maps();checkWeb(before,after,meta)});
for(const path of ['assets/old.js','downloads/ff.apk'])test('rejects change to '+path,()=>{const {before,after}=maps();after.set(path,'wrong');assert.throws(()=>checkWeb(before,after,meta))});
test('rejects removed old bundle',()=>{const {before,after}=maps();after.delete('assets/old.js');assert.throws(()=>checkWeb(before,after,meta))});
test('rejects wrong APK',()=>{const {before,after}=maps();after.set('downloads/logoff-tsd.apk','wrong');assert.throws(()=>checkWeb(before,after,meta))});
test('rejects unexpected files',()=>{const {before,after}=maps();after.set('secret','wrong');assert.throws(()=>checkWeb(before,after,meta))});
test('rejects stale channel',()=>{const {before,after}=maps();assert.throws(()=>checkWeb(before,after,{...meta,versionCode:161}))});
