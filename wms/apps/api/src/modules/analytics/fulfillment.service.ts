import {BadRequestException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {PrismaService} from '../../common/prisma/prisma.service';
import {ClientScopeService} from '../auth/client-scope.service';
import type {AuthUser} from '../auth/auth.types';
import {analyzeFulfillment,validateFulfillmentOptions,type FulfillmentOptions,type ProductFact,type DailyFact,type StockDelta} from './fulfillment-math';
import {groupFulfillment} from './fulfillment-groups';

export const fulfillmentAnalyticsEnabled=()=>process.env.WMS_FULFILLMENT_ANALYTICS_ENABLED==='true';
export type FulfillmentQuery={clientId:string;warehouseId:string;dateFrom:string;dateTo:string;channel:'FBS'|'FBO';leadDays?:number;reviewDays?:number;safetyDays?:number};
@Injectable()
export class FulfillmentAnalyticsService{
 constructor(private readonly prisma:PrismaService,private readonly scopes:ClientScopeService){}
 private enabled(){if(!fulfillmentAnalyticsEnabled())throw new NotFoundException('Аналитика отгрузок не включена.');}
 private warehouseScope(user:AuthUser){const clientOnly=user.roleCodes.includes('CLIENT')&&!user.roleCodes.some(r=>['ADMIN','OWNER','MANAGER','OPERATOR'].includes(r));return clientOnly||user.permissionCodes.includes('system:admin')||user.roleCodes.includes('OWNER')?undefined:{in:user.warehouseIds??[]};}
 async clients(user:AuthUser){
  // FIX: match the main client directory: archived clients are not selectable in FBS/FBO analytics.
  this.enabled();const filter=this.scopes.resolveClientFilter(user);
  // FIX: use the header branch, intersected with access rights, for both selectors.
  const branch=user.activeWarehouseId?.trim()||undefined,allowed=this.warehouseScope(user);
  if(branch&&allowed&&!allowed.in.includes(branch))throw new ForbiddenException('Нет доступа к складу.');
  const clients=await this.prisma.client.findMany({where:{id:filter,isDemo:!!user.isDemo,status:{not:'ARCHIVED'},...(branch?{warehouseLinks:{some:{warehouseId:branch,status:'ACTIVE' as const}}}:{})},select:{id:true,name:true,code:true},orderBy:{name:'asc'}});
  const links=await this.prisma.warehouseClient.findMany({where:{clientId:{in:clients.map(c=>c.id)},warehouseId:branch??allowed,...(branch?{status:'ACTIVE' as const}:{})},select:{clientId:true,warehouse:{select:{id:true,name:true}}}});
  return clients.map(c=>({...c,warehouses:links.filter(l=>l.clientId===c.id).map(l=>l.warehouse)}));
 }
 async dashboard(q:FulfillmentQuery,user:AuthUser){
  this.enabled();if(!q.clientId||!q.warehouseId)throw new BadRequestException('Выберите клиента и склад ФФ.');this.scopes.requireClientAccess(user,q.clientId,'read');
  const allowed=this.warehouseScope(user);if(allowed&&!allowed.in.includes(q.warehouseId))throw new ForbiddenException('Нет доступа к складу.');
  const o:FulfillmentOptions={dateFrom:q.dateFrom,dateTo:q.dateTo,channel:q.channel,leadDays:q.leadDays??7,reviewDays:q.reviewDays??7,safetyDays:q.safetyDays??3,asOf:new Date().toISOString()};
  try{validateFulfillmentOptions(o);}catch(e){throw new BadRequestException((e as Error).message);}
  const client=await this.prisma.client.findFirst({where:{id:q.clientId,isDemo:!!user.isDemo},select:{id:true,name:true,code:true}});if(!client)throw new NotFoundException('Клиент не найден.');
  const link=await this.prisma.warehouseClient.findFirst({where:{clientId:q.clientId,warehouseId:q.warehouseId},select:{warehouse:{select:{id:true,name:true}}}});if(!link)throw new ForbiddenException('Склад не подключён к клиенту.');
  const from=new Date(q.dateFrom+'T00:00:00+03:00'),until=new Date(new Date(q.dateTo+'T00:00:00+03:00').getTime()+86400000),asOf=new Date(o.asOf);
  // FIX: classify only explicit FBS/FBO relations. Do not label B2B shipments as FBO.
  const completed=Prisma.sql`WITH completed AS (
   SELECT r.id, MIN(e."createdAt") AS at,
    CASE WHEN EXISTS(SELECT 1 FROM "FbsOrderRequestLink" l WHERE l."requestId"=r.id AND l."clientId"=r."clientId") THEN 'FBS'
     WHEN EXISTS(SELECT 1 FROM "FboAssembly" a WHERE a."requestId"=r.id) OR EXISTS(SELECT 1 FROM "OzonFboShipment" a WHERE a."requestId"=r.id)
      OR EXISTS(SELECT 1 FROM "YandexFbyShipment" a WHERE a."requestId"=r.id) OR EXISTS(SELECT 1 FROM "LamodaFboAssembly" a WHERE a."requestId"=r.id) THEN 'FBO' ELSE 'OTHER' END AS channel
   FROM "ClientRequest" r JOIN "ClientRequestEvent" e ON e."requestId"=r.id AND e."clientId"=r."clientId" AND e."statusTo"='DONE'
   WHERE r."clientId"=${q.clientId} AND r."warehouseId"=${q.warehouseId} AND r.type='OUTBOUND' AND r.status='DONE'
   GROUP BY r.id HAVING MIN(e."createdAt")>=${from} AND MIN(e."createdAt")<${until}
  )`;
  const data=await this.prisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   const products=await tx.$queryRaw<Array<ProductFact&{category:string|null;brand:string|null;marketplacePayload:unknown}>>(Prisma.sql`
    WITH movements AS (
     SELECT "skuId",MIN("createdAt") FILTER(WHERE type='RECEIPT' AND quantity>0) AS first_receipt,
      COALESCE(SUM(quantity) FILTER(WHERE type='RECEIPT' AND quantity>0 AND "createdAt">=${from} AND "createdAt"<${until}),0)::float AS received,
      COALESCE(SUM(quantity) FILTER(WHERE type='RETURN' AND quantity>0 AND "createdAt">=${from} AND "createdAt"<${until}),0)::float AS returned,
      COALESCE(SUM(quantity) FILTER(WHERE status<>'IN_TRANSIT'),0)::float AS ledger
     FROM "StockMovement" WHERE "clientId"=${q.clientId} AND "warehouseId"=${q.warehouseId} GROUP BY "skuId"
    ), receipts AS (
     SELECT "boxId",MIN("createdAt") AS at FROM "StockMovement" WHERE "clientId"=${q.clientId} AND "warehouseId"=${q.warehouseId} AND type='RECEIPT' AND quantity>0 AND "boxId" IS NOT NULL GROUP BY "boxId"
    ), balances AS (
     SELECT b."skuId",SUM(b.quantity)::float AS total,
      COALESCE(SUM(b.quantity) FILTER(WHERE b.status='AVAILABLE'),0)::float AS available,
      COALESCE(SUM(b.quantity) FILTER(WHERE b.status IN ('RESERVED','PACKING','SHIPPING')),0)::float AS allocated,
      COALESCE(SUM(b.quantity) FILTER(WHERE COALESCE(i."receiptAt",r.at)<=${asOf} AND b.quantity>0),0)::float AS known,
      COALESCE(SUM(b.quantity*EXTRACT(EPOCH FROM (${asOf}::timestamp-COALESCE(i."receiptAt",r.at)))/86400) FILTER(WHERE COALESCE(i."receiptAt",r.at)<=${asOf} AND b.quantity>0),0)::float AS age
     FROM "StockBalance" b LEFT JOIN "ReceiptStockIdentity" i ON i."boxId"=b."boxId" LEFT JOIN receipts r ON r."boxId"=b."boxId"
     WHERE b."clientId"=${q.clientId} AND b."warehouseId"=${q.warehouseId} AND b.status<>'IN_TRANSIT' GROUP BY b."skuId"
    ), pending AS (
     SELECT i."skuId",SUM(GREATEST(i.quantity,0))::float AS units FROM "ClientRequestItem" i JOIN "ClientRequest" r ON r.id=i."requestId"
     WHERE r."clientId"=${q.clientId} AND r."warehouseId"=${q.warehouseId} AND r.type='OUTBOUND' AND r.status NOT IN ('DONE','CANCELLED','REJECTED') GROUP BY i."skuId"
    ) SELECT s.id AS "skuId",s.name,s.article,s.size,s.color,s.category,s.brand,
     jsonb_build_object('fabricRollBinding',s."marketplacePayload"->'fabricRollBinding') AS "marketplacePayload",
     COALESCE(m.received,0) AS "receivedUnits",COALESCE(m.returned,0) AS "returnedUnits",
     COALESCE(b.total,0) AS "currentUnits",COALESCE(b.available,0) AS "availableUnits",COALESCE(b.allocated,0) AS "allocatedUnits",COALESCE(p.units,0) AS "openDemandUnits",
     m.first_receipt AS "firstReceiptAt",COALESCE(b.age,0) AS "ageUnitDays",COALESCE(b.known,0) AS "ageKnownUnits",0::float AS "shippedAgeUnitDays",0::float AS "shippedAgeKnownUnits",COALESCE(m.ledger,0) AS "ledgerUnits"
    FROM "Sku" s LEFT JOIN movements m ON m."skuId"=s.id LEFT JOIN balances b ON b."skuId"=s.id LEFT JOIN pending p ON p."skuId"=s.id WHERE s."clientId"=${q.clientId}
    ORDER BY s.id LIMIT 20001`);
   if(products.length>20000)throw new BadRequestException('Слишком большой каталог для этого отчёта: требуется отдельная выгрузка.');
   const shipments=await tx.$queryRaw<Array<DailyFact&{age:number;known:number}>>(Prisma.sql`${completed}, quantities AS (
    SELECT c.id,c.at,i."skuId",SUM(GREATEST(i.quantity,0))::float AS units FROM completed c JOIN "ClientRequestItem" i ON i."requestId"=c.id
    JOIN "Sku" s ON s.id=i."skuId" AND s."clientId"=${q.clientId} WHERE c.channel=${q.channel} GROUP BY c.id,c.at,i."skuId"
   ), receipts AS (
    SELECT "boxId",MIN("createdAt") AS at FROM "StockMovement" WHERE "clientId"=${q.clientId} AND "warehouseId"=${q.warehouseId} AND type='RECEIPT' AND quantity>0 AND "boxId" IS NOT NULL GROUP BY "boxId"
   ), trace AS (
    SELECT m."sourceDocument" AS id,m."skuId",SUM(-m.quantity)::float AS units,
     COALESCE(SUM(-m.quantity) FILTER(WHERE COALESCE(i."receiptAt",r.at)<=m."createdAt"),0)::float AS known,
     COALESCE(SUM(-m.quantity*EXTRACT(EPOCH FROM (m."createdAt"-COALESCE(i."receiptAt",r.at)))/86400) FILTER(WHERE COALESCE(i."receiptAt",r.at)<=m."createdAt"),0)::float AS age
    FROM "StockMovement" m JOIN completed c ON c.id=m."sourceDocument" LEFT JOIN "ReceiptStockIdentity" i ON i."boxId"=m."boxId" LEFT JOIN receipts r ON r."boxId"=m."boxId"
    WHERE m."clientId"=${q.clientId} AND m."warehouseId"=${q.warehouseId} AND m.type='SHIP' AND m.quantity<0 GROUP BY m."sourceDocument",m."skuId"
   ) SELECT q."skuId",to_char(q.at+interval '3 hours','YYYY-MM-DD') AS date,SUM(q.units)::float AS units,COUNT(*)::int AS requests,array_agg(DISTINCT q.id) AS "requestIds",
    COALESCE(SUM(t.known) FILTER(WHERE t.units<=q.units),0)::float AS known,COALESCE(SUM(t.age) FILTER(WHERE t.units<=q.units),0)::float AS age
   FROM quantities q LEFT JOIN trace t ON t.id=q.id AND t."skuId"=q."skuId" GROUP BY q."skuId",date ORDER BY date,q."skuId"`);
   const deltas=await tx.$queryRaw<StockDelta[]>(Prisma.sql`SELECT "skuId",to_char("createdAt"+interval '3 hours','YYYY-MM-DD') AS date,SUM(quantity)::float AS quantity FROM "StockMovement"
    WHERE "clientId"=${q.clientId} AND "warehouseId"=${q.warehouseId} AND status<>'IN_TRANSIT' AND "createdAt">=${from} GROUP BY "skuId",date`);
   const quality=await tx.$queryRaw<Array<{unclassifiedRequests:number;missingSkuUnits:number;completedRequests:number}>>(Prisma.sql`${completed} SELECT
    (SELECT COUNT(*)::int FROM completed WHERE channel='OTHER') AS "unclassifiedRequests",
    (SELECT COALESCE(SUM(GREATEST(i.quantity,0)),0)::float FROM completed c JOIN "ClientRequestItem" i ON i."requestId"=c.id LEFT JOIN "Sku" s ON s.id=i."skuId" AND s."clientId"=${q.clientId} WHERE c.channel=${q.channel} AND s.id IS NULL) AS "missingSkuUnits",
    (SELECT COUNT(*)::int FROM completed WHERE channel=${q.channel}) AS "completedRequests"`);
   return {products,shipments,deltas,quality:quality[0]};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:60000});
  const ages=new Map<string,{age:number;known:number}>();for(const s of data.shipments){const a=ages.get(s.skuId)??{age:0,known:0};a.age+=s.age;a.known+=s.known;ages.set(s.skuId,a);}
  const products=data.products.filter(p=>p.currentUnits!==0||p.receivedUnits||p.returnedUnits||ages.has(p.skuId)).map(p=>({...p,firstReceiptAt:p.firstReceiptAt?new Date(p.firstReceiptAt).toISOString():null,shippedAgeUnitDays:ages.get(p.skuId)?.age??0,shippedAgeKnownUnits:ages.get(p.skuId)?.known??0}));
  // FIX: retain private catalog evidence server-side; only derived grouping labels reach the report.
  const facts=products.map(({category,brand,marketplacePayload,...fact})=>fact);
  const result=analyzeFulfillment(facts,data.shipments,data.deltas,o);
  return {...result,groups:groupFulfillment(products,data.shipments,data.deltas,o,result.items),client,warehouse:link.warehouse,quality:data.quality};
 }
}
