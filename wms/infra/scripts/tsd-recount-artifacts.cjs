// TEST: allow only reviewed API source/compiled modules and additive web assets/APK.
const fs=require('node:fs'), assert=require('node:assert/strict');
const root='/opt/logoff-wms-backups/tsd-admin-recount-20260907/';
const allowed=['modules/administration/administration-internal-api.service','modules/marketplace-connections/marketplace-connections.service','modules/marketplace-connections/tsd-admin-recount-release','modules/stock/stock-operations.service','modules/stock/tsd-physical-stock-reconciliation','modules/stock/tsd-transfer-kiz-recount','modules/tsd/tsd-device.controller'];
function hashes(name){return new Map(fs.readFileSync(root+name,'utf8').trim().split('\n').map(line=>{const m=/^([a-f0-9]{64})\s+(.+)$/.exec(line);assert(m);return [m[2],m[1]];}));}
const before=hashes('api-before.sha256'), after=hashes('api-candidate.sha256');
const changed=[...new Set([...before.keys(),...after.keys()])].filter(p=>/\.(ts|js)$/.test(p)&&before.get(p)!==after.get(p));
for(const p of changed){assert(after.has(p),'Removed '+p);assert(allowed.some(a=>p==='/app/apps/api/src/'+a+'.ts'||p==='/app/apps/api/dist/'+a+'.js'),'Unreviewed '+p);}
assert.equal(changed.length,14,'Expected seven source and seven compiled modules');
const oldWeb=hashes('web-before.sha256'), newWeb=hashes('web-candidate.sha256');
for(const [p,h] of oldWeb){assert(newWeb.has(p),'Removed web file '+p);if(!p.endsWith('/index.html'))assert.equal(newWeb.get(p),h,'Overwritten web file '+p);}
for(const p of newWeb.keys())if(!oldWeb.has(p))assert(p.startsWith('/usr/share/nginx/html/assets/')||p==='/usr/share/nginx/html/downloads/logoff-tsd-kiz-recount-157.apk','Unexpected new web file '+p);
assert.equal(newWeb.get('/usr/share/nginx/html/downloads/logoff-tsd-kiz-recount-157.apk'),'1e1d5b15078d97e64f5c84485ac324b1cfcf3f9c4f2d07cbb2e8214a97fbce1a');
console.log(JSON.stringify({status:'PASS',changedApiArtifacts:changed.length,existingDownloadsPreserved:true}));
