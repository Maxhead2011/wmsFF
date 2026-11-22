// FIX: own-installation policy; preserve actual WB statuses and require exact supply membership.
export const closedSupplyEnabled=()=>process.env.WMS_WB_CLOSED_SUPPLY_COMPLETION_ENABLED==='true';
export const proofKey=(id:string)=>'wb-closed-supply-proof:v1:'+id;
export function closedSupplyMatches(expected:string[],supply:{done:boolean;orderIds:string[]}) {
 return supply.done===true && expected.length>0 && new Set(expected).size===expected.length &&
 new Set(supply.orderIds).size===supply.orderIds.length && expected.length===supply.orderIds.length && expected.every(id=>supply.orderIds.includes(id));
}
export async function closedSupplyBillingKeys(db:any,clientId:string):Promise<Set<string>> {
 if(!closedSupplyEnabled())return new Set();
 const rows=await db.systemSetting.findMany({where:{key:{startsWith:'wb-closed-supply-proof:v1:'}},select:{value:true}});
 return new Set(rows.flatMap((r:any)=>r.value?.clientId===clientId ? (r.value.orders??[]).map((o:any)=>o.connectionId+':'+o.id):[]));
}
