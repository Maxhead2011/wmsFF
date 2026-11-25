// TEST: run the exact compiled candidate against selected live postings; prohibit client refresh and business writes.
const assert=require('assert/strict'),path=require('path');
const root=process.argv[2]||'/app/apps/api/dist';
const {PrismaClient}=require(require.resolve('@prisma/client',{paths:[root]}));
const {MarketplaceConnectionsService:S}=require(path.join(root,'modules/marketplace-connections/marketplace-connections.service.js'));
const p=new PrismaClient(),calls=[],originalFetch=global.fetch;
global.fetch=async(url,init)=>{const started=Date.now();try{return await originalFetch(url,init);}finally{const u=new URL(url);calls.push({path:u.hostname==='api-seller.ozon.ru'?u.pathname:'label-cdn',ms:Date.now()-started});}};
const db=new Proxy(p,{get(target,name){if(name==='$queryRaw'||name==='$queryRawUnsafe'||name==='$transaction')throw Error('Raw/transaction writer unavailable');const delegate=target[name];if(!delegate||typeof delegate!=='object')return delegate;return new Proxy(delegate,{get(d,method){if(!['findUnique','findFirst','findMany','count','aggregate','groupBy'].includes(String(method)))throw Error('Business write prohibited: '+String(name)+'.'+String(method));return d[method].bind(d);}});}});
process.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='true';
process.env.WMS_FBS_ACTION_STATUS_ENABLED='false';
(async()=>{try{
 const reports=[];
 for(const number of [3299,3290]){
  const r=await p.clientRequest.findUnique({where:{number},select:{id:true,clientId:true}});assert(r);
  const links=await p.fbsOrderRequestLink.findMany({where:{requestId:r.id},select:{orderId:true,connectionId:true}});
  const service=new S(db,{requireClientAccess(_user,id,mode){assert.equal(id,r.clientId);assert.equal(mode,'read');}});
  for(const name of ['loadFbsOrders','loadFbsOrdersUncached','resolveSelectedFbsOrders'])service[name]=async()=>{throw Error('Full refresh forbidden: '+name)};
  const started=Date.now(),before=calls.length;
  const result=await service.getFbsAllLabels({clientId:r.clientId,orders:links.map(l=>({id:l.orderId,connectionId:l.connectionId}))},{id:'read-only-release-check'});
  assert.equal(result.pageCount,number===3299?3:11);assert.deepEqual(result.warnings,[]);
  reports.push({request:number,ms:Date.now()-started,pages:result.pageCount,warnings:result.warnings,calls:calls.slice(before),noFullRefresh:true,noBusinessWrites:true});
 }
 console.log(JSON.stringify({passed:true,reports}));
}finally{await p.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1});
