// TEST: polling the open screen refreshes a minute-old snapshot even with a daily scheduler.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=fs.readFileSync(process.argv[2],'utf8');
const match=source.slice(source.indexOf('async listFbsOrdersForDisplay(')).match(/if \((refresh \|\| !value \|\| [^\n]+?)\) \{/);
assert.ok(match);
const now=Date.now();
function due(age){return vm.runInNewContext(match[1],{refresh:false,value:{fetchedAt:new Date(now-age).toISOString()},Date:{now:()=>now,parse:Date.parse},FBS_ORDERS_CACHE_TTL_MS:3*86400000});}
assert.equal(due(59000),false);assert.equal(due(60000),true);
