
const assert=require('node:assert/strict');
const {OzonAssemblySupplyService}=require('/app/apps/api/dist/modules/client-requests/ozon-assembly-supply.service');
(async()=>{
 const ids=['1000000000064215122','1000000000064215123','1000000000064215124'],calls=[];
 global.fetch=async(url,init)=>{calls.push({url,body:init.body});return new Response(calls.length===1?'{"cargoes":['+ids.map(id=>'{"cargo_id":'+id+'}').join(',')+']}':'{}')};
 const svc=new OzonAssemblySupplyService({},{});
 const result=await svc.call({},'/v2/cargoes/create/info',{});
 assert.deepEqual(result.cargoes.map(x=>x.cargo_id),ids);
 await svc.call({},'/v1/cargoes-label/create',{cargoes:result.cargoes},false);
 assert.equal(calls[1].body,'{"cargoes":['+ids.map(id=>'{"cargo_id":'+id+'}').join(',')+']}');
 console.log(JSON.stringify({passed:true,exactInt64Read:true,exactInt64Write:true,noBusinessWrites:true}));
})().catch(e=>{console.error(e);process.exit(1)});
