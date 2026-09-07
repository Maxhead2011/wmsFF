// TEST: release gates never hide newly failing tests or overwrite unrelated live artifacts.
const fs=require('node:fs'),assert=require('node:assert/strict');
const root=process.argv[2]; assert(root);
const read=n=>JSON.parse(fs.readFileSync(root+'/'+n,'utf8'));
const a=read('full-baseline.json'),b=read('full-candidate.json');
const failures=r=>r.testResults.flatMap(s=>{const f=(s.assertionResults||[]).filter(t=>t.status==='failed').map(t=>s.name+'::'+t.fullName);return s.status==='failed'&&!f.length?[s.name+'::LOAD']:f});
const prior=new Set(failures(a));assert.deepEqual(failures(b).filter(x=>!prior.has(x)),[]);assert(b.numPassedTests>=a.numPassedTests);
function hashes(n){return new Map(fs.readFileSync(root+'/'+n,'utf8').trim().split('\n').map(l=>{const m=/^([a-f0-9]{64})\s+(.+)$/.exec(l);assert(m);return[m[2],m[1]]}))}
const old=hashes('api-before.sha256'),next=hashes('api-candidate.sha256');
const changed=[...new Set([...old.keys(),...next.keys()])].filter(p=>old.get(p)!==next.get(p));
const modules=['stock-operations.service','tsd-transfer-kiz-recount','tsd-admin-box-recount'];
for(const p of changed){assert(next.has(p));assert(modules.some(m=>p==='/app/apps/api/src/modules/stock/'+m+'.ts'||p==='/app/apps/api/dist/modules/stock/'+m+'.js'),p)}
assert.equal(changed.length,6);
const ow=hashes('web-before.sha256'),nw=hashes('web-candidate.sha256');
for(const[p,h]of ow)assert.equal(nw.get(p),h,p);
const apk='/usr/share/nginx/html/downloads/logoff-tsd-admin-box-count-158.apk';
assert.deepEqual([...nw.keys()].filter(p=>!ow.has(p)),[apk]);
assert.equal(nw.get(apk),fs.readFileSync(root+'/apk.sha256','utf8').trim());
console.log(JSON.stringify({status:'PASS',baselinePassed:a.numPassedTests,baselineFailed:a.numFailedTests,candidatePassed:b.numPassedTests,candidateFailed:b.numFailedTests,changedApiFiles:changed.length,oldWebUnchanged:true}));
