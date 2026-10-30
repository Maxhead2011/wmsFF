import type {Prisma} from '@prisma/client';
import {storeDirectoryKey} from './client-store-receipt';
import {storeForConnection,validateStoreDirectory} from './client-stores.policy';

type Db=Pick<Prisma.TransactionClient,'systemSetting'|'clientMarketplaceConnection'|'fbsOrderRequestLink'|'ozonFboShipment'>;
export type RequestStoreContext={storeNames:string[];storeIds:string[];storeState:'ASSIGNED'|'MIXED'|'UNASSIGNED'};
// FIX: classify only authorized request IDs, never infer a shop from a common physical SKU.
export async function requestStoreContexts(db:Db, requests:readonly {id:string;clientId:string}[]):Promise<Map<string,RequestStoreContext>> {
  const result=new Map<string,RequestStoreContext>();
  if(process.env.WMS_CLIENT_STORES_ENABLED!=='true'||!requests.length)return result;
  const clients=[...new Set(requests.map(r=>r.clientId))];
  const [settings,connections,links,shipments]=await Promise.all([
    db.systemSetting.findMany({where:{key:{in:clients.map(storeDirectoryKey)}}}),
    db.clientMarketplaceConnection.findMany({where:{clientId:{in:clients}},select:{id:true,clientId:true}}),
    db.fbsOrderRequestLink.findMany({where:{OR:requests.map(r=>({requestId:r.id,clientId:r.clientId}))},select:{requestId:true,clientId:true,connectionId:true}}),
    db.ozonFboShipment.findMany({where:{OR:requests.map(r=>({requestId:r.id,request:{clientId:r.clientId}}))},select:{requestId:true,integration:true}}),
  ]);
  for(const clientId of clients){
    const setting=settings.find(s=>s.key===storeDirectoryKey(clientId));if(!setting)continue;
    const stores=validateStoreDirectory(setting.value,connections.filter(c=>c.clientId===clientId).map(c=>c.id));
    for(const request of requests.filter(r=>r.clientId===clientId)){
      const ids=new Set(links.filter(l=>l.requestId===request.id&&l.clientId===clientId).map(l=>l.connectionId));
      const integration=shipments.find(s=>s.requestId===request.id)?.integration;
      if(integration&&typeof integration==='object'&&!Array.isArray(integration)&&typeof integration.connectionId==='string')ids.add(integration.connectionId);
      const matched=[...ids].map(id=>storeForConnection(stores,id));
      const resolved=stores.filter(s=>matched.some(m=>m?.id===s.id));
      result.set(request.id,{storeIds:resolved.map(s=>s.id),storeNames:resolved.map(s=>s.name),
        storeState:!ids.size||matched.some(s=>!s)?'UNASSIGNED':resolved.length===1?'ASSIGNED':'MIXED'});
    }
  }
  return result;
}
