// TEST: publishing a versioned APK must also update the default download and TSD metadata.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const meta=JSON.parse(fs.readFileSync(path.join(root,'apps/web/public/downloads/logoff-tsd.json'),'utf8'));
test('default update advertises Logoff 161 on immutable URL',()=>{
 // TEST: the source-choice/focus fix must be installable as an upgrade, not a same-version APK.
 assert.equal(meta.versionCode,161);assert.equal(meta.versionName,'0.1.162-sorting-scan');
 assert.equal(meta.apkUrl,'https://wms.logoff.pro/downloads/logoff-tsd-sorting-scan-161.apk');
 const gradle=fs.readFileSync(path.join(root,'apps/android-tsd/app/build.gradle.kts'),'utf8');
 assert.match(gradle,/create\("logoff"\)\s*\{[^}]*versionCode = 161/);
});
test('default APK is the same signed release advertised in metadata',()=>{
 const apk=fs.readFileSync(path.join(root,'apps/web/public/downloads/logoff-tsd.apk'));
 const hash=createHash('sha256').update(apk).digest('hex');
 assert.equal(hash,'8dc0a542d26f633fbf89895ff2a004fe6c5b77b3e6f3b62b2284f5a251122a96');
 assert.equal(meta.sha256,hash);assert.equal(meta.size,apk.length);assert.equal(apk.length,2256125);
});
test('release refuses unrelated web replacement or missing files',()=>{
 const {verify}=require('./tsd-default-update-verify.cjs');const apk='/usr/share/nginx/html/downloads/logoff-tsd.apk',json='/usr/share/nginx/html/downloads/logoff-tsd.json';
 const before=new Map([[apk,'old'],[json,'old'],['index.html','same']]);
 const after=new Map([[apk,meta.sha256],[json,'new'],['index.html','same']]);verify(before,after);
 after.set('index.html','different');assert.throws(()=>verify(before,after));after.delete('index.html');assert.throws(()=>verify(before,after));
});
test('release CLI validates the exact staged artifact manifests',()=>{
 // TEST: exercise the same CLI used on the release host, without any production access.
 const {execFileSync}=require('node:child_process'),os=require('node:os');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsd-channel-test-'));
 const apk='/usr/share/nginx/html/downloads/logoff-tsd.apk',json='/usr/share/nginx/html/downloads/logoff-tsd.json';
 const file=n=>path.join(dir,n);
 try {
  fs.writeFileSync(file('before.sha256'),`${'a'.repeat(64)}  ${apk}\n${'b'.repeat(64)}  ${json}\n`);
  fs.writeFileSync(file('after.sha256'),`${meta.sha256}  ${apk}\n${'c'.repeat(64)}  ${json}\n`);
  assert.match(execFileSync(process.execPath,[path.join(__dirname,'tsd-default-update-verify.cjs'),dir],{encoding:'utf8'}),/ONLY_DEFAULT_APK_AND_METADATA_CHANGED/);
 } finally {fs.unlinkSync(file('before.sha256'));fs.unlinkSync(file('after.sha256'));fs.rmdirSync(dir);}
});
