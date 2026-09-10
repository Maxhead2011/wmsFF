// FIX: immutable release boundary for our WMS; no APK, stock, migration or configuration replacement.
const fs=require('node:fs'),assert=require('node:assert/strict');
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
function manifest(path){return new Map(fs.readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(line=>{const match=line.match(/^([a-f0-9]{64})\s+(.+)$/);assert(match,'Invalid manifest');return[match[2],match[1]];}));}
if(require.main===module){
 const [mode,a,b]=process.argv.slice(2);
 if(mode==='api')verifyApi(manifest(a),manifest(b));
 else if(mode==='web')verifyWeb(manifest(a),manifest(b));
 else if(mode==='pr')verifyPr(JSON.parse(fs.readFileSync(a,'utf8')),b);
 else if(mode==='baseline'){
  for(const name of apiModules){
   const expected=a+'/wms/apps/api/src/'+name+'.ts',actual=b+'/'+name+'.ts';
   if(fs.existsSync(expected)){assert(fs.existsSync(actual),'Missing live source: '+name);assert(fs.readFileSync(expected,'utf8').replace(/\r\n/g,'\n')===fs.readFileSync(actual,'utf8').replace(/\r\n/g,'\n'),'Live baseline drift: '+name);}
   else assert(!fs.existsSync(actual),'New source already exists live: '+name);
  }
 }else throw Error('Unknown verification mode');
 console.log('BILLING_RELEASE_'+mode.toUpperCase()+'_PASS');
}
module.exports={apiModules,verifyApi,verifyWeb,verifyPr};

