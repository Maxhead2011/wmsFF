const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const r=path.resolve(process.argv[2]),n='modules/analytics/fulfillment.service.js',s=fs.readFileSync(r+'/base-api/'+n,'utf8');
const before='where: { id: filter, isDemo: !!user.isDemo }',after="where: { id: filter, isDemo: !!user.isDemo, status: { not: 'ARCHIVED' } }";assert.equal(s.split(before).length,2);
// FIX: retain every other byte of the published analytics service.
for(const kind of ['api','candidate']){const p=r+'/'+kind+'/'+n;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s.replace(before,after));}
fs.writeFileSync(r+'/api-changes.json',JSON.stringify([n]));console.log('Exact analytics client-filter delta');
