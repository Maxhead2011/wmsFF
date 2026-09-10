// TEST: deployment accepts only billing overlays and an explicitly merged billing PR.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {verifyApi,verifyWeb,verifyPr,apiModules}=require('./billing-release-artifacts.cjs');
const {verifyLiveBaseline,approvedLiveApiHashes}=require('./billing-release-artifacts.cjs');
const {verifyTestEvidence}=require('./billing-release-artifacts.cjs');

const evidenceApi='sha256:'+'a'.repeat(64),evidenceWeb='sha256:'+'b'.repeat(64),evidenceHead='c'.repeat(40);
const evidenceNow=Date.parse('2026-09-10T12:00:00.000Z');
const evidenceChecks=['apiTests','webTests','postgresTests','apiBuild','webBuild','uiTests'];
function validEvidence(){return {version:1,checkedAt:new Date(evidenceNow).toISOString(),
 apiImage:evidenceApi,webImage:evidenceWeb,headSha:evidenceHead,
 checks:Object.fromEntries(evidenceChecks.map(name=>[name,true]))};}
function checkEvidence(value,now=evidenceNow){return verifyTestEvidence(value,evidenceApi,evidenceWeb,evidenceHead,now);}

// TEST: successful checks authorize only the tested immutable images and exact source revision.
test('test evidence accepts the exact images and head through the inclusive 24-hour boundary',()=>{
 assert.equal(typeof verifyTestEvidence,'function');
 assert.doesNotThrow(()=>checkEvidence(validEvidence()));
 assert.doesNotThrow(()=>checkEvidence({...validEvidence(),checkedAt:new Date(evidenceNow-86400000).toISOString()}));
});

test('test evidence rejects empty records and unsupported versions',()=>{
 for(const evidence of [undefined,null,'',true,[],{}, {...validEvidence(),version:undefined}, {...validEvidence(),version:2}])
  assert.throws(()=>checkEvidence(evidence),/test evidence/i);
});

test('test evidence rejects stale, future, missing and invalid timestamps',()=>{
 for(const checkedAt of [undefined,null,'',0,'invalid-date',new Date(evidenceNow-86400001).toISOString(),new Date(evidenceNow+1).toISOString()])
  assert.throws(()=>checkEvidence({...validEvidence(),checkedAt}),/test evidence.*time/i);
 assert.throws(()=>checkEvidence(validEvidence(),NaN),/test evidence.*time/i);
});

test('test evidence rejects every changed immutable image or source revision',()=>{
 for(const patch of [{apiImage:'sha256:'+'d'.repeat(64)},{webImage:'sha256:'+'d'.repeat(64)},{headSha:'d'.repeat(40)}])
  assert.throws(()=>checkEvidence({...validEvidence(),...patch}),/test evidence.*match/i);
});

test('test evidence requires complete canonical image IDs and a full git SHA in both inputs',()=>{
 for(const image of ['', 'candidate:latest','sha256:abc','a'.repeat(64),'sha256:'+'a'.repeat(63),'sha256:'+'g'.repeat(64),evidenceApi+'\n']){
  assert.throws(()=>checkEvidence({...validEvidence(),apiImage:image}),/test evidence.*image/i);
  assert.throws(()=>checkEvidence({...validEvidence(),webImage:image}),/test evidence.*image/i);
  assert.throws(()=>verifyTestEvidence(validEvidence(),image,evidenceWeb,evidenceHead,evidenceNow),/test evidence.*image/i);
  assert.throws(()=>verifyTestEvidence(validEvidence(),evidenceApi,image,evidenceHead,evidenceNow),/test evidence.*image/i);
 }
 for(const head of ['', 'HEAD','abcdef0','c'.repeat(39),'g'.repeat(40),evidenceHead+'\n']){
  assert.throws(()=>checkEvidence({...validEvidence(),headSha:head}),/test evidence.*head/i);
  assert.throws(()=>verifyTestEvidence(validEvidence(),evidenceApi,evidenceWeb,head,evidenceNow),/test evidence.*head/i);
 }
});

test('test evidence requires each named check to be the boolean true',()=>{
 for(const checks of [undefined,null,[],true])assert.throws(()=>checkEvidence({...validEvidence(),checks}),/test evidence.*checks/i);
 for(const name of evidenceChecks)for(const value of [undefined,null,false,'true',1])
  assert.throws(()=>checkEvidence({...validEvidence(),checks:{...validEvidence().checks,[name]:value}}),new RegExp('test evidence.*'+name,'i'));
});

// TEST: exercise argv routing and JSON parsing, not only the exported verifier.
test('tests CLI validates evidence JSON against all three supplied release identities',()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wms-billing-evidence-'));
 const filename=path.join(directory,'evidence.json');
 const cli=path.join(__dirname,'billing-release-artifacts.cjs');
 try{
  fs.writeFileSync(filename,JSON.stringify({...validEvidence(),checkedAt:new Date().toISOString()}));
  const accepted=spawnSync(process.execPath,[cli,'tests',filename,evidenceApi,evidenceWeb,evidenceHead],{encoding:'utf8'});
  assert.equal(accepted.status,0,accepted.stderr);
  assert.match(accepted.stdout,/^BILLING_RELEASE_TESTS_PASS\s*$/);
  const mismatch=spawnSync(process.execPath,[cli,'tests',filename,evidenceApi,evidenceWeb,'d'.repeat(40)],{encoding:'utf8'});
  assert.notEqual(mismatch.status,0);
  assert.doesNotMatch(mismatch.stdout,/BILLING_RELEASE_TESTS_PASS/);
 }finally{fs.unlinkSync(filename);fs.rmdirSync(directory);}
});

// TEST: resuming an interrupted stage must reuse only verified, unpublished backups.
test('resume stage preserves backup and rechecks live provenance before builds',()=>{
 const script=require('node:fs').readFileSync(require('node:path').join(__dirname,'billing-register-release.sh'),'utf8');
 assert.match(script,/stage\|resume-stage\)/);
 assert.match(script,/test ! -e "\$b\/published-at"/);
 assert.match(script,/test ! -s "\$b\/tests-passed"/);
 assert.match(script,/sha256sum -c "\$b\/backup.sha256"/);
 assert.match(script,/cmp \/opt\/logoff-wms\/wms\/\.env "\$b\/env-before"/);
 assert.match(script,/baseline "\$b\/live-api-src"/);
 assert.match(script,/mktemp -d "\$b\/web-proof\.XXXXXX"/);
 assert.doesNotMatch(script,/rm -rf|prisma (migrate|db push)/);
});

// TEST: baseline compilation must use the source that produced the running web bundle.
test('web proof uses the verified live builder without restoring obsolete Git web sources',()=>{
 const dockerfile=require('node:fs').readFileSync(require('node:path').join(__dirname,'../billing-register.Dockerfile'),'utf8');
 const proof=dockerfile.match(/FROM ([^\r\n]+) AS web-proof\r?\n([\s\S]*?)FROM web-proof AS web-build/);
 assert(proof,'Missing web-proof stage');
 assert.equal(proof[1],'sha256:dac013135170e749479da1f2c3b7deb3e22146b3193a4ec5e7c0d4e10d93fb36');
 assert.doesNotMatch(proof[2],/COPY\s+base\/wms\/apps\/web\/src\//);
 assert.match(proof[2],/typescript\/bin\/tsc -p tsconfig\.json/);
 assert.match(proof[2],/vite\/bin\/vite\.js build/);
});

// TEST: changing a mutable candidate directory or head cannot reuse successful staging/tests.
test('release rechecks source proof in stage and publish and binds staging to the reviewed head',()=>{
 const script=require('node:fs').readFileSync(require('node:path').join(__dirname,'billing-register-release.sh'),'utf8');
 const stage=script.match(/stage\|resume-stage\)([\s\S]*?)\n publish\)/)?.[1];
 const publish=script.match(/\n publish\)([\s\S]*?)\n \*\)/)?.[1];
 assert(stage&&publish,'Missing release stages');
 assert.match(stage,/node "\$sourceproof" verify "\$context\/source-proof\.json" "\$context\/candidate" "\$stagehead"/);
 assert.match(publish,/node "\$sourceproof" verify "\$r\/source-proof\.json" "\$r\/candidate" "\$\(cat "\$r\/head-sha"\)"/);
 assert(stage.indexOf('node "$sourceproof" verify')<stage.indexOf('docker build'),'Proof must precede candidate builds');
 assert.match(stage,/cp "\$context\/head-sha" "\$b\/staged-head"/);
 assert.match(publish,/cmp "\$r\/head-sha" "\$b\/staged-head"/);
 assert.match(publish,/node "\$verify" tests "\$b\/tests-passed" "\$an" "\$wn" "\$\(cat "\$r\/head-sha"\)"/);
 const firstPublication=publish.indexOf('docker tag "$an" infra-api:latest');
 assert(firstPublication>0,'Missing candidate publication');
 for(const check of ['node "$sourceproof" verify','cmp "$r/head-sha" "$b/staged-head"','node "$verify" tests'])
  assert(publish.indexOf(check)<firstPublication,check+' must precede publication');
});

// TEST: a second upload must not change either build input or its recorded source identity.
test('stage verifies and builds a private frozen source snapshot and records its copied head',()=>{
 const script=require('node:fs').readFileSync(require('node:path').join(__dirname,'billing-register-release.sh'),'utf8');
 const stage=script.match(/stage\|resume-stage\)([\s\S]*?)\n publish\)/)?.[1];
 assert(stage,'Missing stage');
 assert.match(stage,/context=\$\(mktemp -d "\$b\/build-context\.XXXXXX"\)/);
 const copies=[
  'cp -a "$r/candidate/." "$context/candidate/"',
  'cp "$r/source-proof.json" "$context/source-proof.json"',
  'cp "$r/head-sha" "$context/head-sha"',
  'cp "$r/wms/infra/billing-register.Dockerfile" "$context/wms/infra/billing-register.Dockerfile"',
 ];
 const captured='stagehead=$(cat "$context/head-sha")';
 const verified='node "$sourceproof" verify "$context/source-proof.json" "$context/candidate" "$stagehead"';
 const firstBuild=stage.indexOf('docker build');
 assert(stage.includes(captured)&&stage.includes(verified),'Missing frozen source identity/proof');
 for(const copy of copies){
  assert(stage.includes(copy),'Missing frozen artifact: '+copy);
  assert(stage.indexOf(copy)<stage.indexOf(captured),'All artifacts must be copied before capturing the head');
 }
 assert(stage.indexOf(captured)<stage.indexOf(verified),'Verify the captured head');
 assert(stage.indexOf(verified)<firstBuild,'Frozen proof must precede every build');
 const builds=stage.split(/\r?\n/).filter(line=>line.includes('docker build'));
 assert.equal(builds.length,2,'Check both proof build and API/web build loop');
 for(const build of builds){
  assert.match(build,/-f "\$context\/wms\/infra\/billing-register\.Dockerfile"/);
  assert.match(build,/"\$context" > /);
  assert.doesNotMatch(build,/"\$r(?:\/|"\s)/,'A build must not reread the mutable upload directory');
 }
 assert.match(stage,/cp "\$context\/head-sha" "\$b\/staged-head"/);
 assert.doesNotMatch(stage,/cp "\$r\/head-sha" "\$b\/staged-head"/);
});

// TEST: reviewed deployed hashes, not an obsolete checkout, authorize the baseline.
test('live baseline accepts only the reviewed deployed source snapshot',()=>{
 assert.equal(typeof verifyLiveBaseline,'function');
 const snapshot=new Map(Object.entries(approvedLiveApiHashes).filter(([,hash])=>hash!==null));
 assert.doesNotThrow(()=>verifyLiveBaseline(snapshot));
 const existing=apiModules.find(name=>approvedLiveApiHashes[name]!==null);
 const changed=new Map(snapshot);changed.set(existing,'0'.repeat(64));
 assert.throws(()=>verifyLiveBaseline(changed),/baseline drift/);
 const missing=new Map(snapshot);missing.delete(existing);
 assert.throws(()=>verifyLiveBaseline(missing),/baseline drift/);
 const newFile=apiModules.find(name=>approvedLiveApiHashes[name]===null);
 const unexpected=new Map(snapshot);unexpected.set(newFile,'0'.repeat(64));
 assert.throws(()=>verifyLiveBaseline(unexpected),/already exists/);
});
test('only billing source/JS may change; stock is immutable',()=>{
 const before=new Map([['/app/apps/api/dist/modules/stock/stock.service.js','a']]);
 const after=new Map(before); after.set('/app/apps/api/dist/'+apiModules[0]+'.js','b');
 assert.doesNotThrow(()=>verifyApi(before,after));
 after.set('/app/apps/api/dist/modules/stock/stock.service.js','b');
 assert.throws(()=>verifyApi(before,after),/Unexpected/);
});
test('web keeps downloads and old hashed assets for open browser tabs',()=>{
 const before=new Map([['/usr/share/nginx/html/downloads/logoff-tsd.apk','apk'],['/usr/share/nginx/html/assets/old.js','old']]);
 const after=new Map(before);after.set('/usr/share/nginx/html/assets/new.js','new');after.set('/usr/share/nginx/html/index.html','index');
 assert.doesNotThrow(()=>verifyWeb(before,after));
 after.set('/usr/share/nginx/html/downloads/logoff-tsd.apk','changed');assert.throws(()=>verifyWeb(before,after));
 after.set('/usr/share/nginx/html/downloads/logoff-tsd.apk','apk');after.delete('/usr/share/nginx/html/assets/old.js');assert.throws(()=>verifyWeb(before,after));
});
test('publication requires the exact merged PR and head SHA',()=>{
 const pr={merged:true,merge_commit_sha:'merge',head:{ref:'feature/billing-period-register-20260910',sha:'head'},base:{ref:'fix/sorting-recorded-source-20260908'}};
 assert.doesNotThrow(()=>verifyPr(pr,'head'));assert.throws(()=>verifyPr({...pr,merged:false},'head'));
 assert.throws(()=>verifyPr(pr,'other'));assert.throws(()=>verifyPr({...pr,base:{ref:'main'}},'head'));
});
