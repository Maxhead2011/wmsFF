const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const r=path.resolve(process.argv[2]),n='modules/analytics/fulfillment.service.js';let s=fs.readFileSync(r+'/base-api/'+n,'utf8');
// FIX: exact delta over the freshly verified production service; preserve every other method.
function replace(a,b){assert.equal(s.split(a).length,2);s=s.replace(a,b);}
replace('const filter = this.scopes.resolveClientFilter(user);',`const filter = this.scopes.resolveClientFilter(user);
        const branch = user.activeWarehouseId?.trim() || undefined, allowed = this.warehouseScope(user);
        if (branch && allowed && !allowed.in.includes(branch)) throw new common_1.ForbiddenException('Нет доступа к складу.');`);
replace("status: { not: 'ARCHIVED' } }, select:","status: { not: 'ARCHIVED' }, ...(branch ? { warehouseLinks: { some: { warehouseId: branch, status: 'ACTIVE' } } } : {}) }, select:");
replace('warehouseId: this.warehouseScope(user) }, select:',"warehouseId: branch ?? allowed, ...(branch ? { status: 'ACTIVE' } : {}) }, select:");
for(const kind of ['api','candidate']){const p=r+'/'+kind+'/'+n;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);}
fs.writeFileSync(r+'/api-changes.json',JSON.stringify([n]));console.log('Exact selected-branch selector delta');
