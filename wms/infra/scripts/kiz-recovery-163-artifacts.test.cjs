const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {checkWeb}=require('./kiz-recovery-163-artifacts.cjs');
const hash='a'.repeat(64),meta={versionCode:163,versionName:'0.1.164-kiz-recovery',apkUrl:'https://wms.logoff.pro/downloads/logoff-tsd-kiz-recovery-163.apk',sha256:hash};
const before=new Map([['index.html','old'],['assets/old.js','old'],['downloads/ff-tsd.apk','old'],['downloads/logoff-tsd.apk','old'],['downloads/logoff-tsd.json','old']]);
const make=()=>new Map([...before,['downloads/logoff-tsd.apk',hash],['downloads/logoff-tsd.json','new'],['downloads/logoff-tsd-kiz-recovery-163.apk',hash]]);
// TEST: fail closed on regression in release artifact selection.
test('only APK and channel change',()=>checkWeb(before,make(),meta));
for(const path of ['index.html','assets/old.js','downloads/ff-tsd.apk'])test('reject unrelated change '+path,()=>{const m=make();m.set(path,'changed');assert.throws(()=>checkWeb(before,m,meta));});
test('reject missing old APK',()=>{const m=make();m.delete('downloads/ff-tsd.apk');assert.throws(()=>checkWeb(before,m,meta));});
test('reject wrong APK hash',()=>{const m=make();m.set('downloads/logoff-tsd.apk','bad');assert.throws(()=>checkWeb(before,m,meta));});
test('release metadata agrees with signed artifact',()=>{const path=require('node:path'),root=path.resolve(__dirname,'../..'),m=JSON.parse(fs.readFileSync(root+'/apps/web/public/downloads/logoff-tsd.json')),apk=fs.readFileSync(root+'/apps/web/public/downloads/logoff-tsd.apk');assert.equal(m.versionCode,163);assert.equal(m.size,apk.length);assert.equal(m.sha256,crypto.createHash('sha256').update(apk).digest('hex'));});
