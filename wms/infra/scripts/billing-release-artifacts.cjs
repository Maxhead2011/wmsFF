// FIX: immutable release boundary for our WMS; no APK, stock, migration or configuration replacement.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
// FIX: reviewed source hashes from the pinned running API image e08a056b...
// Keep the gate strict even when Git's historical base differs from deployed code.
const approvedLiveApiHashes={
  "modules/administration/administration-internal-api.service": "9718864c7d9e5a4e4116e2797a7e9e7ef3e33b8e6e01e734541ba45300ec2b6d",
  "modules/billing/billing.controller": "9dfeb4df85d585d414a167f2ec9bc04d3dcbe2359ef05f23958ce3c9b5bb5893",
  "modules/billing/billing.module": "7f0d1767da1b4cd2a2f24f615294217d6a1d55e3a5abd801ff806317f415708c",
  "modules/billing/billing.service": "fce0eff4937547571c87ab80bac256f271d070e8aedf18cee4ba27c56b67c79e",
  "modules/billing/dto/list-billing-invoices.dto": "d453ca568961754dc4bf0439913a05f8690a07df43c354a1ccd516661473562f",
  "modules/billing/request-billing-automation.service": "cd2eb851a51657f6703e9d7374bf5c040193a0129ae591efc938fcd32476efea",
  "modules/marketplace-connections/marketplace-connections.service": "2554366b3e098c2ef407b42935cf60272f00447c5b78496b42a6e911e7ad2826",
  "modules/billing/billing-mutation": null,
  "modules/billing/billing-period-policy": null,
  "modules/billing/billing-period.service": null,
  "modules/billing/dto/generate-billing-period.dto": null
};
function verifyLiveBaseline(actual){
 for(const name of apiModules){
  assert(Object.hasOwn(approvedLiveApiHashes,name),'Unreviewed baseline module: '+name);
  const expected=approvedLiveApiHashes[name];
  if(expected===null)assert(!actual.has(name),'New source already exists live: '+name);
  else assert(actual.get(name)===expected,'Live baseline drift: '+name);
 }
}
const apiModules=[
  "modules/administration/administration-internal-api.service",
  "modules/billing/billing.controller",
  "modules/billing/billing.module",
  "modules/billing/billing.service",
  "modules/billing/dto/list-billing-invoices.dto",
  "modules/billing/request-billing-automation.service",
  "modules/marketplace-connections/marketplace-connections.service",
  "modules/billing/billing-mutation",
  "modules/billing/billing-period-policy",
  "modules/billing/billing-period.service",
  "modules/billing/dto/generate-billing-period.dto"
];
function verifyApi(before,after){
 const allowed=new Set(apiModules.flatMap(name=>['/app/apps/api/src/'+name+'.ts','/app/apps/api/dist/'+name+'.js']));
 for(const [path,hash]of before){assert(after.has(path),'Deleted API artifact: '+path);if(after.get(path)!==hash)assert(allowed.has(path),'Unexpected API change: '+path);}
 for(const path of after.keys())if(!before.has(path))assert(allowed.has(path),'Unexpected API addition: '+path);
}
function verifyWeb(before,after){
 for(const [path,hash]of before){assert(after.has(path),'Deleted web artifact: '+path);if(path!=='/usr/share/nginx/html/index.html')assert(after.get(path)===hash,'Unexpected web replacement: '+path);}
 for(const path of after.keys())if(!before.has(path))assert(path.startsWith('/usr/share/nginx/html/assets/')||path==='/usr/share/nginx/html/index.html','Unexpected web addition: '+path);
}
function verifyPr(pr,head){
 assert(pr.merged&&pr.merge_commit_sha,'PR must be merged');assert(pr.head?.sha===head,'PR head changed');
 assert(pr.head.ref==='feature/billing-period-register-20260910','Wrong PR head branch');
 assert(pr.base?.ref==='fix/sorting-recorded-source-20260908','Wrong PR base');
}
// FIX: a test marker authorizes only the exact tested source and immutable image pair for 24 hours.
function verifyTestEvidence(evidence,apiImage,webImage,headSha,now=Date.now()){
 assert(evidence&&typeof evidence==='object'&&!Array.isArray(evidence),'Invalid test evidence record');
 assert(evidence.version===1,'Unsupported test evidence version');
 const imageId=/^sha256:[a-f0-9]{64}$/;
 for(const value of [apiImage,webImage,evidence.apiImage,evidence.webImage]){
  assert(typeof value==='string'&&imageId.test(value),'Invalid test evidence image ID');
 }
 const gitSha=/^[a-f0-9]{40}$/;
 for(const value of [headSha,evidence.headSha]){
  assert(typeof value==='string'&&gitSha.test(value),'Invalid test evidence head SHA');
 }
 assert(evidence.apiImage===apiImage,'Test evidence API image does not match');
 assert(evidence.webImage===webImage,'Test evidence web image does not match');
 assert(evidence.headSha===headSha,'Test evidence head SHA does not match');
 const checkedAt=typeof evidence.checkedAt==='string'?Date.parse(evidence.checkedAt):NaN;
 const currentTime=now instanceof Date?now.getTime():now;
 assert(Number.isFinite(currentTime)&&Number.isFinite(checkedAt),'Invalid test evidence timestamp');
 assert(checkedAt<=currentTime,'Test evidence timestamp is in the future');
 assert(currentTime-checkedAt<=24*60*60*1000,'Test evidence timestamp is stale');
 assert(evidence.checks&&typeof evidence.checks==='object'&&!Array.isArray(evidence.checks),'Invalid test evidence checks');
 for(const name of ['apiTests','webTests','postgresTests','apiBuild','webBuild','uiTests']){
  assert(evidence.checks[name]===true,'Test evidence check missing or failed: '+name);
 }
}
function manifest(path){return new Map(fs.readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(line=>{const match=line.match(/^([a-f0-9]{64})\s+(.+)$/);assert(match,'Invalid manifest');return[match[2],match[1]];}));}
if(require.main===module){
 const [mode,a,b,c,d]=process.argv.slice(2);
 if(mode==='api')verifyApi(manifest(a),manifest(b));
 else if(mode==='web')verifyWeb(manifest(a),manifest(b));
 else if(mode==='pr')verifyPr(JSON.parse(fs.readFileSync(a,'utf8')),b);
 else if(mode==='tests')verifyTestEvidence(JSON.parse(fs.readFileSync(a,'utf8')),b,c,d);
 else if(mode==='baseline'){
  const actual=new Map();
  for(const name of apiModules){
   const path=a+'/'+name+'.ts';
   if(fs.existsSync(path))actual.set(name,crypto.createHash('sha256').update(fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n')).digest('hex'));
  }
  verifyLiveBaseline(actual);
 }else throw Error('Unknown verification mode');
 console.log('BILLING_RELEASE_'+mode.toUpperCase()+'_PASS');
}
module.exports={apiModules,verifyApi,verifyWeb,verifyPr,verifyLiveBaseline,approvedLiveApiHashes,verifyTestEvidence};
