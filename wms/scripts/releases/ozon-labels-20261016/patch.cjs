const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const file=path.join(process.argv[2],'modules/client-requests/ozon-assembly-supply.service.js');
const old="(read || path === '/v1/cargoes/create') && r.status === 429";
const replacement="(read || path === '/v1/cargoes/create' || path === '/v1/cargoes-label/create') && r.status === 429";
const source=fs.readFileSync(file,'utf8');assert.equal(source.split(old).length,2,'Expected exact production retry predicate');fs.writeFileSync(file,source.replace(old,replacement));
