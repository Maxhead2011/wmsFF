import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientStore, storeForConnection, validateStoreDirectory } from './client-stores.policy';
import { skuStoresKey, validateSkuStores } from './client-store-receipt';

@Injectable()
export class ClientStoresService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService) {}
  private key(clientId: string) { return `client.stores.v1:${clientId}`; }
  private async check(clientId: string, user: AuthUser, mode: 'read' | 'write') {
    if (process.env.WMS_CLIENT_STORES_ENABLED !== 'true') throw new NotFoundException('Магазины клиента не включены.');
    this.scopes.requireClientAccess(user, clientId, mode);
    const client = await this.prisma.client.findFirst({where:{id:clientId,isDemo:Boolean(user.isDemo)},select:{id:true}});
    if (!client) throw new NotFoundException('Клиент не найден.');
  }
  async get(clientId: string, user: AuthUser) {
    await this.check(clientId,user,'read');
    const [setting,connections] = await Promise.all([
      this.prisma.systemSetting.findUnique({where:{key:this.key(clientId)}}),
      this.prisma.clientMarketplaceConnection.findMany({where:{clientId},select:{id:true,marketplace:true,accountName:true,isActive:true}}),
    ]);
    let stores: ClientStore[] = [];
    if (setting) {
      try { stores = validateStoreDirectory(setting.value, connections.map((c)=>c.id)); }
      catch { throw new BadRequestException('Связи магазинов требуют проверки администратором.'); }
    }
    return {clientId,stores,connections};
  }
  async save(clientId: string, value: unknown, user: AuthUser) {
    await this.check(clientId,user,'write');
    if (!user.roleCodes.some((r)=>r==='ADMIN'||r==='OWNER')) throw new ForbiddenException('Магазины настраивает администратор или собственник.');
    const connections=await this.prisma.clientMarketplaceConnection.findMany({where:{clientId},select:{id:true}});
    let stores:ClientStore[];
    try { stores=validateStoreDirectory(value,connections.map(c=>c.id)); }
    catch(e) { throw new BadRequestException(e instanceof Error?e.message:'Неверные магазины.'); }
    // FIX: identity changes need an explicit migration, not an unnoticed reassignment of history.
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${this.key(clientId)}))`;
      const previous=await tx.systemSetting.findUnique({where:{key:this.key(clientId)}});
      if(previous){
        const old=validateStoreDirectory(previous.value,connections.map(c=>c.id));
        for(const store of old){
          const next=stores.find(s=>s.id===store.id);
          if(!next||store.connectionIds.some(id=>!next.connectionIds.includes(id))) throw new BadRequestException('Перенос подключения или удаление магазина требует отдельной сверки истории.');
        }
      }
      await tx.systemSetting.upsert({where:{key:this.key(clientId)},create:{key:this.key(clientId),value:stores,updatedByUserId:user.id},update:{value:stores,updatedByUserId:user.id}});
      await tx.auditLog.create({data:{userId:user.id,action:'CLIENT_STORES_SAVED',entity:'Client',entityId:clientId,
        payload:{before:previous?.value??null,after:stores}}});
      return {clientId,stores};
    });
  }
  // FIX: membership changes are explicit, audited and do not clone shared physical stock.
  async getSkuStores(clientId: string, skuId: string, user: AuthUser) {
    const {stores} = await this.get(clientId, user);
    const sku = await this.prisma.sku.findFirst({where: {id: skuId, clientId}, select: {id: true}});
    if (!sku) throw new NotFoundException('Товар клиента не найден.');
    const setting = await this.prisma.systemSetting.findUnique({where: {key: skuStoresKey(clientId, skuId)}});
    return {clientId, skuId, storeIds: setting ? validateSkuStores(setting.value, stores.map(s => s.id)) : []};
  }
  async saveSkuStores(clientId: string, skuId: string, value: unknown, expected: unknown, user: AuthUser) {
    await this.check(clientId, user, 'write');
    if (!user.roleCodes.some(r => r === 'ADMIN' || r === 'OWNER')) throw new ForbiddenException('Связи товара настраивает администратор или собственник.');
    if (!Array.isArray(expected) || expected.some(id => typeof id !== 'string')) throw new BadRequestException('Нужна исходная версия связей товара.');
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${this.key(clientId)}))`;
      const sku = await tx.sku.findFirst({where: {id: skuId, clientId}, select: {id: true}});
      if (!sku) throw new NotFoundException('Товар клиента не найден.');
      const directory = await tx.systemSetting.findUnique({where: {key: this.key(clientId)}});
      const connections = await tx.clientMarketplaceConnection.findMany({where: {clientId}, select: {id: true}});
      let stores: ClientStore[];
      try { stores = validateStoreDirectory(directory?.value, connections.map(c => c.id)); }
      catch { throw new BadRequestException('Сначала настройте магазины клиента.'); }
      const storeIds = validateSkuStores(value, stores.map(s => s.id));
      const key = skuStoresKey(clientId, skuId);
      const previous = await tx.systemSetting.findUnique({where: {key}});
      const before = previous ? validateSkuStores(previous.value, stores.map(s => s.id)) : [];
      if (JSON.stringify([...expected].sort()) !== JSON.stringify(before)) throw new BadRequestException('Связи изменились. Обновите товар и повторите проверку.');
      if (before.some(id => !storeIds.includes(id))) throw new BadRequestException('Удаление магазина у товара требует сверки активных резервов и истории.');
      await tx.systemSetting.upsert({where: {key}, create: {key, value: storeIds, updatedByUserId: user.id}, update: {value: storeIds, updatedByUserId: user.id}});
      await tx.auditLog.create({data: {userId: user.id, action: 'SKU_STORES_SAVED', entity: 'Sku', entityId: skuId, payload: {clientId, before, after: storeIds}}});
      return {clientId, skuId, storeIds};
    });
  }
  async decorateOrders<T extends {connections: {id:string}[]; orders: {connectionId:string}[]}>(clientId:string, response:T, user:AuthUser) {
    // FIX: the sold WMS and clients without a configured directory retain the exact old payload.
    if(process.env.WMS_CLIENT_STORES_ENABLED!=='true') return response;
    const {stores}=await this.get(clientId,user);
    if(!stores.length) return response;
    const visibleConnections=new Set(response.connections.map(c=>c.id));
    const visibleStores=stores.map(s=>({...s,connectionIds:s.connectionIds.filter(id=>visibleConnections.has(id))})).filter(s=>s.connectionIds.length);
    return {...response,stores:visibleStores,orders:response.orders.map(order=>{
      const store=storeForConnection(visibleStores,order.connectionId);
      return {...order,storeId:store?.id??null,storeName:store?.name??null};
    })};
  }
}
