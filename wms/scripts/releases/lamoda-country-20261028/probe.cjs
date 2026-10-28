require('reflect-metadata');
const assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client');
const {LamodaClient,openSecret}=require('/app/apps/api/dist/modules/lamoda/lamoda-client');
const db=new PrismaClient();
(async()=>{
 const c=await db.lamodaAccount.findFirstOrThrow({where:{sellerId:'1060287436',isActive:true}});
 const secret=openSecret(c.encryptedSecret,JSON.stringify([c.clientId,c.sellerId,c.oauthClientId]));
 const statuses=[];
 const http=async(url,init)=>{const r=await fetch(url,init);statuses.push({path:new URL(url).pathname,status:r.status});return r};
 await new LamodaClient(http).check({oauthClientId:c.oauthClientId,secret,sellerId:c.sellerId});
 assert.deepEqual(statuses.map(x=>x.status),[201,200]);
 // TEST: compiled runtime paginates catalog at 25, unrelated orders remain at 100.
 for(const kind of ['CATALOG','ORDERS']){
  let count=0;
  const client=new LamodaClient(async(url)=>{
   if(url.endsWith('auth-token'))return Response.json({access_token:'test',expires_in:3600,token_type:'bearer'});
   const q=new URL(url).searchParams, page=Number(q.get('page'));count++;
   assert.equal(q.get('sellerId'),'seller');assert.equal(q.get('limit'),kind==='CATALOG'?'25':'100');
   assert.equal(q.get('country'),kind==='CATALOG'?'RU':null);
   return Response.json({[kind==='CATALOG'?'nomenclatures':'orders']:[{id:page}],meta:{page,totalPages:2}});
  });
  assert.equal((await client.collection({sellerId:'seller',oauthClientId:'client',secret:'test'},kind)).length,2);assert.equal(count,2);
 }
 console.log(JSON.stringify({passed:3,readOnly:true,statuses}));
})().finally(()=>db.$disconnect()).catch(()=>{console.error('Lamoda candidate check failed');process.exitCode=1});
