// TEST: deployment accepts only billing overlays and an explicitly merged billing PR.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {verifyApi,verifyWeb,verifyPr,apiModules}=require('./billing-release-artifacts.cjs');
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

