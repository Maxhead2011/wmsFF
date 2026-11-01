import { BadGatewayException, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertWarehouseAccess, warehouseScopeWhere } from './client-request-warehouse-scope';
import { assertRequestNotRemoved } from './request-removal-policy';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';
import { closeWbPackedRequest } from '../marketplace-connections/wb-packed-auto-done';
import { closeOzonPackedRequest } from '../marketplace-connections/ozon-packed-auto-done';
import { WbFboSupplyService } from './wb-fbo-supply.service';
import { OzonAssemblySupplyService } from './ozon-assembly-supply.service';
import { FboDeliverySyncService } from './fbo-delivery-sync.service';
import { supplyOrders } from './ozon-supply-policy';
import { LamodaClient, openSecret } from '../lamoda/lamoda-client';
import { LamodaSubmission } from '../lamoda/lamoda-submission';

type Link = { marketplace: string; connectionId: string; orderId: string; syncStatus: string };
type Observation = { id: string; marketplace: string; connectionId: string; supplierStatus: string; wbStatus: string };
const linkIdentity = (links: Link[]) => JSON.stringify(links.map(l =>
  JSON.stringify([l.marketplace,l.connectionId,l.orderId,l.syncStatus])).sort());

@Controller('client-requests')
@RequirePermissions('client-requests:write','client-requests:status')
export class RequestMarketStatusController {
  constructor(private db: PrismaService, private scopes: ClientScopeService,
    private connections: MarketplaceConnectionsService, private ozon: OzonAssemblySupplyService,
    private wb: WbFboSupplyService, private delivery: FboDeliverySyncService) {}

  // FIX: force a scoped read from the marketplace, then apply the ordinary completion policy.
  @Get('market-status/targets')
  async targets(@CurrentUser() user:AuthUser) {
    if (process.env.WMS_FBO_DELIVERY_SYNC_ENABLED !== 'true') throw new NotFoundException();
    if (user.isDemo) throw new ForbiddenException();
    const rows = await this.db.clientRequest.findMany({where:{
      type:'OUTBOUND',status:{notIn:['DONE','CANCELLED','REJECTED']},client:{isDemo:false},
      clientId:this.scopes.resolveClientFilter(user),...warehouseScopeWhere(user,'write'),
      ...(user.activeWarehouseId?{warehouseId:user.activeWarehouseId}:{}),yandexFbyShipment:null,
      OR:[{fbsOrderLinks:{some:{marketplace:{in:['OZON','WILDBERRIES']}}}},
        {ozonShipment:{isNot:null}},{lamodaAssembly:{isNot:null}},{fboAssembly:{isNot:null}}]
    },select:{id:true,number:true,clientId:true},orderBy:{number:'asc'}});
    const all=user.permissionCodes.includes('system:admin')||user.clientScopeMode==='ALL';
    return rows.filter(r=>all||user.writableClientIds.includes(r.clientId)).map(({id,number})=>({id,number}));
  }

  @Post(':id/market-status')
  async check(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    if (process.env.WMS_FBO_DELIVERY_SYNC_ENABLED !== 'true') throw new NotFoundException();
    if (user.isDemo) throw new ForbiddenException();
    const r = await this.db.clientRequest.findUnique({where:{id}, include:{
      client:{select:{isDemo:true}}, fbsOrderLinks:true, ozonShipment:{select:{requestId:true}},
      lamodaAssembly:{include:{plan:true}}, fboAssembly:{select:{phase:true}}, yandexFbyShipment:{select:{id:true}}
    }});
    if (!r || r.client.isDemo) throw new NotFoundException();
    this.scopes.requireClientAccess(user,r.clientId,'write');
    assertWarehouseAccess(user,r,'write');
    await assertRequestNotRemoved(this.db,id);
    if (r.type !== 'OUTBOUND' || ['DONE','CANCELLED','REJECTED'].includes(r.status))
      throw new ConflictException('Проверка доступна для открытой заявки на отгрузку.');
    let message: string;
    if (r.fbsOrderLinks.length) {
      message = await this.checkFbs(id,r.clientId,r.fbsOrderLinks,user);
    } else if (r.lamodaAssembly) {
      const {plan} = r.lamodaAssembly;
      const account = await this.db.lamodaAccount.findFirst({where:{id:plan.accountId,clientId:r.clientId,isActive:true}});
      if (!account) throw new ConflictException('Кабинет Lamoda недоступен.');
      const credentials = {sellerId:account.sellerId,oauthClientId:account.oauthClientId,
        secret:openSecret(account.encryptedSecret,JSON.stringify([r.clientId,account.sellerId,account.oauthClientId]))};
      const remote = new LamodaClient();
      const submission = new LamodaSubmission(this.db,remote);
      if ((await submission.view(account.id,id,user)).receipt) {
        const receipt = await submission.refresh(account.id,id,user,credentials);
        message = 'Lamoda · '+receipt.remoteStatus;
      } else {
        const remoteId = plan.remoteShipmentId;
        if (!remoteId) throw new ConflictException('Привяжите поставку Lamoda.');
        const {shipment:snapshot} = await remote.fboShipment(credentials,remoteId);
        if (snapshot.id !== remoteId || String(snapshot.sellerId)!==account.sellerId || typeof snapshot.status!=='string')
          throw new BadGatewayException('Lamoda не подтвердила статус привязанной поставки.');
        const status = snapshot.status;
        await this.db.$transaction(async tx=>{
          const current = await tx.lamodaPlan.findUnique({where:{id:plan.id}});
          if (current?.accountId!==account.id || current.remoteShipmentId!==remoteId) throw new ConflictException('Привязка Lamoda изменилась.');
          await tx.lamodaDocument.upsert({where:{accountId_kind_remoteId:{accountId:account.id,kind:'FBO_SHIPMENTS',remoteId}},
            update:{status,syncedAt:new Date()},create:{accountId:account.id,kind:'FBO_SHIPMENTS',remoteId,number:String(snapshot.number??remoteId),status,payload:{id:remoteId,status}}});
        },{isolationLevel:'Serializable'});
        message = 'Lamoda · '+status;
      }
    } else if (r.ozonShipment) {
      const view = await this.ozon.refresh(id,user);
      message = 'Ozon · '+(view.link ? supplyOrders(view.link).map(o=>o.orderNumber+' '+o.state).join(', ') : 'поставка не привязана');
      await this.delivery.reconcile(id,undefined,r);
    } else if (r.fboAssembly && !r.yandexFbyShipment) {
      const view = await this.wb.refresh(id,user,true);
      if (view.binding?.lastError) throw new BadGatewayException(view.binding.lastError);
      message = 'WB · '+(view.binding?.status??'поставка не привязана');
      await this.delivery.reconcile(id,undefined,r);
      if (view.binding && [4,5,6].includes(view.binding.statusId) && !view.dispatch)
        message += ' · В WMS требуется отметка загрузки в автомобиль';
    } else throw new ConflictException('У заявки нет поддерживаемой привязки к маркетплейсу.');
    const current = await this.db.clientRequest.findUniqueOrThrow({where:{id},select:{status:true}});
    return {status:current.status,message,checkedAt:new Date().toISOString()};
  }

  private async checkFbs(id:string, clientId:string, links:Link[],user:AuthUser) {
    const active = links.filter(l=>!['ADMIN_REMOVED','REMOVED'].includes(l.syncStatus));
    const market = active[0]?.marketplace;
    if (!market || !['WILDBERRIES','OZON'].includes(market) || active.some(l=>l.marketplace!==market || l.syncStatus==='MOVING'))
      throw new ConflictException('Проверьте привязку и перенос отправлений ФБС.');
    const observations: Observation[] = [];
    const started = Date.now();
    for (const connectionId of new Set(active.map(l=>l.connectionId))) {
      const account = await this.db.clientMarketplaceConnection.findFirst({where:{
        id:connectionId,clientId,isActive:true,marketplace:market==='OZON'?'OZON':'WILDBERRIES'}});
      if (!account) throw new ConflictException('Кабинет маркетплейса недоступен.');
      const ids = active.filter(l=>l.connectionId===connectionId).map(l=>l.orderId);
      if (market==='WILDBERRIES') {
        const statuses = await this.connections.readWbStatusesForConnection(account.apiKey,ids);
        for (const orderId of ids) {
          const status=statuses.get(orderId);
          if (!status?.supplierStatus || !status.wbStatus) throw new BadGatewayException('WB вернул неполный ответ.');
          observations.push({id:orderId,connectionId,marketplace:market,...status});
        }
      } else for (const orderId of ids) {
        const response = await this.ozon.call(account,'/v3/posting/fbs/get',{posting_number:orderId});
        const posting = response.result??response;
        if (posting.posting_number!==orderId || typeof posting.status!=='string' || !posting.status)
          throw new BadGatewayException('Ozon вернул неполный ответ.');
        observations.push({id:orderId,connectionId,marketplace:market,supplierStatus:posting.status,wbStatus:posting.status});
      }
    }
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${id} FOR UPDATE`;
      const fresh = await tx.clientRequest.findUniqueOrThrow({where:{id},include:{fbsOrderLinks:true}});
      assertWarehouseAccess(user,fresh,'write');
      await assertRequestNotRemoved(tx,id);
      if (fresh.clientId!==clientId || linkIdentity(fresh.fbsOrderLinks)!==linkIdentity(links) || Date.now()-started>240000)
        throw new ConflictException('Данные заявки изменились. Повторите проверку.');
      const special = !!(await tx.fbsRepeatAssemblyRun.findUnique({where:{requestId:id}}) ??
        await tx.fbsReshipmentRun.findUnique({where:{requestId:id}}));
      const close = market==='OZON'?closeOzonPackedRequest:closeWbPackedRequest;
      await close(tx,fresh,observations,special);
    });
    const counts=new Map<string,number>();
    for(const o of observations){const status=market==='OZON'?o.supplierStatus:o.supplierStatus+'/'+o.wbStatus;counts.set(status,(counts.get(status)??0)+1);}
    return (market==='OZON'?'Ozon':'WB')+' · '+[...counts].map(([status,n])=>status+' ('+n+')').join(', ');
  }
}
