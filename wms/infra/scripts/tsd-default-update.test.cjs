// TEST: publishing a versioned APK must also update the default download and TSD metadata.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const meta=JSON.parse(fs.readFileSync(path.join(root,'apps/web/public/downloads/logoff-tsd.json'),'utf8'));
test('default update advertises Logoff 158 on immutable URL',()=>{
 assert.equal(meta.versionCode,158);assert.equal(meta.versionName,'0.1.159-admin-box-count');
 assert.equal(meta.apkUrl,'https://wms.logoff.pro/downloads/logoff-tsd-admin-box-count-158.apk');
 const gradle=fs.readFileSync(path.join(root,'apps/android-tsd/app/build.gradle.kts'),'utf8');
 assert.match(gradle,/create\("logoff"\)\s*\{[^}]*versionCode = 158/);
});
test('default APK is the same signed release advertised in metadata',()=>{
 const apk=fs.readFileSync(path.join(root,'apps/web/public/downloads/logoff-tsd.apk'));
 const hash=createHash('sha256').update(apk).digest('hex');
 assert.equal(hash,'022edfc8dbaeeac7118752ff6a641a3e57a950da8f47985bf6f81a2bf332ca3b');
 assert.equal(meta.sha256,hash);assert.equal(meta.size,apk.length);assert.equal(apk.length,2243713);
});
test('release refuses unrelated web replacement or missing files',()=>{
 const {verify}=require('./tsd-default-update-verify.cjs');const apk='/usr/share/nginx/html/downloads/logoff-tsd.apk',json='/usr/share/nginx/html/downloads/logoff-tsd.json';
 const before=new Map([[apk,'old'],[json,'old'],['index.html','same']]);
 const after=new Map([[apk,meta.sha256],[json,'new'],['index.html','same']]);verify(before,after);
 after.set('index.html','different');assert.throws(()=>verify(before,after));after.delete('index.html');assert.throws(()=>verify(before,after));
});
