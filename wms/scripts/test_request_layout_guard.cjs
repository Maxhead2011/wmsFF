// TEST: broken header, disclosure arrow and oversized search must fail visually.
const {spawnSync}=require('node:child_process');
const path=require('node:path'),assert=require('node:assert/strict');
const script=path.resolve(__dirname,'../apps/web/src/components/client-requests/request-fold-layout.browser-test.cjs');
for(const [mutation,marker] of [['header','HEADER:'],['fold','FOLD:'],['search','SEARCH:']]) {
 const result=spawnSync(process.execPath,['--test',script],{
  encoding:'utf8',env:{...process.env,REQUEST_FOLDS_MUTATION:mutation},timeout:120000,
 });
 assert.equal(result.status,1,mutation+' must fail');
 assert((result.stdout+result.stderr).includes(marker),mutation+' must fail a layout assertion, not setup');
 console.log('PASS rejects',mutation);
}
