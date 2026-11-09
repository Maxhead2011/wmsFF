// FIX: preserve all current runtime bytes outside the active-request predicate.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const r=path.resolve(process.argv[2]),file='modules/marketplace-connections/sos-post-pick.js';
const base=fs.readFileSync(r+'/api-base/'+file,'utf8');
const old="status: { notIn: ['CANCELLED', 'REJECTED'] }",next="status: { notIn: ['DONE', 'CANCELLED', 'REJECTED'] }";
assert.equal(base.split(old).length,2);const candidate=base.replace(old,next);assert.equal(candidate.replace(next,old),base);
fs.cpSync(r+'/api-base',r+'/api-candidate',{recursive:true});
for(const dir of ['api-payload','api-candidate']) {fs.mkdirSync(path.dirname(r+'/'+dir+'/'+file),{recursive:true});fs.writeFileSync(r+'/'+dir+'/'+file,candidate);}
fs.writeFileSync(r+'/api-changes.json',JSON.stringify([file]));
console.log('One exact active-status predicate change');
