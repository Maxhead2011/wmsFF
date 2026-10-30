// FIX: explicit, audited Ozon-only metadata correction; default is dry-run.
const {PrismaClient}=require('@prisma/client');const assert=require('node:assert/strict');const p=new PrismaClient();(async()=>{
const client=await p.client.findUniqueOrThrow({where:{code:'CL-000016'},select:{id:true,name:true,isDemo:true}});assert.equal(client.id,'634434d6-0d5a-4f6b-8876-6c8d3252cdff');assert(!client.isDemo);
const {validateStoreDirectory}=require('./dist/modules/clients/client-stores.policy');
const directory=[{id:'monlarti',name:'Монларти',connectionIds:['ac0d727b-d1ee-4c26-92c3-0b56fd14be9f']},{id:'braibo',name:'Брайбо',connectionIds:['82ea1c54-30fa-4560-8e41-dfdc84423fdc']}];
const apply=process.argv.includes('--apply');
const result=await p.$transaction(async tx=>{
const key='client.stores.v1:'+client.id;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
const previous=await tx.systemSetting.findUnique({where:{key}});assert.equal(previous,null,'Existing config must be reviewed, never overwritten');
const connections=await tx.clientMarketplaceConnection.findMany({where:{clientId:client.id},select:{id:true,marketplace:true,accountName:true,sellerId:true}});
for(const store of directory){const connection=connections.find(c=>c.id===store.connectionIds[0]);assert.equal(connection?.marketplace,'OZON');assert.equal(connection.accountName,store.name);assert.equal(connection.sellerId,store.id==='monlarti'?'40312':'520725')}
validateStoreDirectory(directory,connections.map(c=>c.id));
const requests=await tx.clientRequest.findMany({where:{clientId:client.id,number:{in:[2529,2530,2531]}},select:{number:true,ozonShipment:{select:{integration:true}}}});assert.equal(requests.length,3);
const mappings=requests.map(r=>({request:r.number,store:directory.find(s=>s.connectionIds.includes(r.ozonShipment.integration.connectionId))?.name}));
for(const r of mappings)assert.equal(r.store,r.request===2531?'Брайбо':'Монларти');
if(apply){await tx.systemSetting.create({data:{key,value:directory}});await tx.auditLog.create({data:{action:'CLIENT_STORES_SAVED',entity:'Client',entityId:client.id,payload:{before:null,after:directory,source:'Codex operational correction',authorizedBy:'Катерина',reason:'User approved configure and publish shop labels; verified Ozon connection and seller IDs. Stock, SKU and KIZ unchanged. WB connections await independent verification.'}}})}
return {apply,client:client.name,directory,mappings,wbUnassigned:connections.filter(c=>c.marketplace==='WILDBERRIES').map(c=>c.id)};
});console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());