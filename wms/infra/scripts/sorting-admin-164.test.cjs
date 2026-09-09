const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
test('release manifest rejects unrelated changes and preserves old bundles',()=>{
 // TEST: web rebuild may add hashed bundles, not replace old downloads or other static files.
 const {checkWeb}=require('./sorting-admin-164-artifacts.cjs');
 const hash='a'.repeat(64),meta={versionCode:164,sha256:hash};
 const before=new Map([['index.html','old'],['assets/old.js','old'],['downloads/ff-tsd.apk','old'],['downloads/logoff-tsd.apk','old'],['downloads/logoff-tsd.json','old']]);
 const after=new Map([...before,['index.html','new'],['assets/new.js','new'],['downloads/logoff-tsd.apk',hash],['downloads/logoff-tsd.json','new'],['downloads/logoff-tsd-sorting-admin-164.apk',hash]]);
 checkWeb(before,after,meta);
 for(const p of ['assets/old.js','downloads/ff-tsd.apk']){const bad=new Map(after);bad.set(p,'changed');assert.throws(()=>checkWeb(before,bad,meta));}
 const bad=new Map(after);bad.delete('assets/old.js');assert.throws(()=>checkWeb(before,bad,meta));
});
test('LOGOFF release 164 channel matches signed APK and leaves sold flavor alone',()=>{
 // TEST: prevent publishing a stale APK or a metadata-only version increment.
 const meta=JSON.parse(fs.readFileSync(root+'/apps/web/public/downloads/logoff-tsd.json'));
 const apk=fs.readFileSync(root+'/apps/web/public/downloads/logoff-tsd.apk');
 assert.equal(meta.versionCode,164);assert.equal(meta.versionName,'0.1.165-sorting-admin');
 assert.equal(meta.apkUrl,'https://wms.logoff.pro/downloads/logoff-tsd-sorting-admin-164.apk');
 assert.equal(meta.size,apk.length);assert.equal(meta.sha256,crypto.createHash('sha256').update(apk).digest('hex'));
 const gradle=fs.readFileSync(root+'/apps/android-tsd/app/build.gradle.kts','utf8');
 const logoff=gradle.split('create("logoff")')[1].split('create("ffullhab")')[0];
 assert.match(logoff,/versionCode = 164/);assert.match(logoff,/applicationId = "pro.logoff.wms.tsd"/);
 const sold=gradle.split('create("ffullhab")')[1].split('create("platform")')[0];
 assert(!sold.includes('versionCode = 164'));assert(sold.includes('pro.ffullhab.wms.tsd'));
});
