import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LamodaAccount } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { ClientRequestsService } from '../client-requests/client-requests.service';
import { assertWarehouseAccess, warehouseScopeWhere } from '../client-requests/client-request-warehouse-scope';
import { LamodaApiError, LamodaClient, lamodaResources, openSecret, sealSecret, type LamodaResource } from './lamoda-client';
import { documentSnapshot, parseLamodaPlan, planHash, productSnapshot, text, type LamodaPlanLine } from './lamoda-policy';
import { lamodaAssemblyEnabled, lamodaShipmentId, lamodaShipmentLines, resolveLamodaLines } from './lamoda-fbo-policy';

const accountSelect = { id: true, clientId: true, name: true, sellerId: true, oauthClientId: true, isActive: true, fboEnabled: true, fbsEnabled: true, checkedAt: true, ordersSyncedAt: true } satisfies Prisma.LamodaAccountSelect;
const identity = (c: Pick<LamodaAccount, 'clientId' | 'sellerId' | 'oauthClientId'>) => JSON.stringify([c.clientId, c.sellerId, c.oauthClientId]);
export type LamodaAccountInput = { clientId: string; name: string; sellerId: string; oauthClientId: string; secret: string; fboEnabled: boolean; fbsEnabled: boolean };

@Injectable()
export class LamodaService {
  private readonly remote = new LamodaClient();
  constructor(private readonly db: PrismaService, private readonly scopes: ClientScopeService, private readonly requests: ClientRequestsService) {}

  private guard(user: AuthUser, mode: 'read' | 'write') {
    if (process.env.WMS_LAMODA_ENABLED !== 'true') throw new NotFoundException();
    if (!user.permissionCodes.includes('system:admin') && !user.permissionCodes.includes(`marketplace-api:${mode}`)) throw new ForbiddenException('Нужны права на API маркетплейсов.');
    if (mode === 'write' && user.isDemo) throw new ForbiddenException('Изменения Lamoda недоступны в демонстрационном кабинете.');
  }
  private async account(id: string, user: AuthUser, mode: 'read' | 'write') {
    this.guard(user, mode);
    const account = await this.db.lamodaAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Подключение Lamoda не найдено.');
    this.scopes.requireClientAccess(user, account.clientId, mode);
    return account;
  }
  private credentials(c: LamodaAccount) {
    if (!c.isActive) throw new BadRequestException('Подключение отключено.');
    return { sellerId: c.sellerId, oauthClientId: c.oauthClientId, secret: openSecret(c.encryptedSecret, identity(c)) };
  }
  private fail(error: unknown): never {
    if (error instanceof LamodaApiError) throw new BadGatewayException(error.message);
    throw error;
  }
  async accounts(clientId: string, user: AuthUser) {
    this.guard(user, 'read');
    this.scopes.requireClientAccess(user, text(clientId, 'Клиент'), 'read');
    return this.db.lamodaAccount.findMany({ where: { clientId }, select: accountSelect, orderBy: { name: 'asc' } });
  }
  async create(body: LamodaAccountInput, user: AuthUser) {
    this.guard(user, 'write');
    const clientId = text(body.clientId, 'Клиент');
    this.scopes.requireClientAccess(user, clientId, 'write');
    const client = await this.db.client.findUnique({ where: { id: clientId }, select: { isDemo: true } });
    if (!client || client.isDemo) throw new BadRequestException('Нужен действующий рабочий клиент.');
    const data = { clientId, name: text(body.name, 'Название'), sellerId: text(body.sellerId, 'Seller ID'), oauthClientId: text(body.oauthClientId, 'OAuth Client ID') };
    if (typeof body.fboEnabled !== 'boolean' || typeof body.fbsEnabled !== 'boolean' || (!body.fboEnabled && !body.fbsEnabled)) throw new BadRequestException('Выберите FBO и/или FBS.');
    const encryptedSecret = sealSecret(text(body.secret, 'Client secret', 2000), identity(data));
    try {
      return await this.db.$transaction(async tx => {
        const saved = await tx.lamodaAccount.create({ data: { ...data, encryptedSecret, fboEnabled: body.fboEnabled, fbsEnabled: body.fbsEnabled }, select: accountSelect });
        await tx.auditLog.create({ data: { userId: user.id, action: 'LAMODA_ACCOUNT_CREATED', entity: 'LamodaAccount', entityId: saved.id, payload: { clientId } } });
        return saved;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Этот Seller ID уже подключён у клиента.');
      return this.fail(error);
    }
  }
  async update(id: string, body: { secret?: string; isActive?: boolean }, user: AuthUser) {
    const c = await this.account(id, user, 'write');
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') throw new BadRequestException('Некорректный статус подключения.');
    if (body.secret === undefined && body.isActive === undefined) throw new BadRequestException('Нет изменений.');
    if (c.syncLeaseUntil && c.syncLeaseUntil > new Date()) throw new ConflictException('Дождитесь завершения загрузки.');
    return this.db.$transaction(async tx => {
      const changed = await tx.lamodaAccount.updateMany({ where: { id, updatedAt: c.updatedAt, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: new Date() } }] }, data: {
        ...(body.secret !== undefined ? { encryptedSecret: sealSecret(text(body.secret, 'Client secret', 2000), identity(c)), checkedAt: null } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      } });
      if (changed.count !== 1) throw new ConflictException('Подключение изменилось или началась загрузка. Повторите действие.');
      const saved = await tx.lamodaAccount.findUniqueOrThrow({ where: { id }, select: accountSelect });
      await tx.auditLog.create({ data: { userId: user.id, action: 'LAMODA_ACCOUNT_UPDATED', entity: 'LamodaAccount', entityId: id, payload: { secretChanged: body.secret !== undefined, isActive: saved.isActive } } });
      return saved;
    });
  }
  async check(id: string, user: AuthUser) {
    const c = await this.account(id, user, 'write');
    try {
      await this.remote.check(this.credentials(c));
      const saved = await this.db.lamodaAccount.updateMany({ where: { id, updatedAt: c.updatedAt, isActive: true }, data: { checkedAt: new Date() } });
      if (saved.count !== 1) throw new ConflictException('Подключение изменилось во время проверки. Повторите проверку.');
      return { message: 'Подключение Lamoda проверено. Отправка остатков и отгрузок выключена.' };
    } catch (error) { return this.fail(error); }
  }
  async overview(id: string, user: AuthUser) {
    await this.account(id, user, 'read');
    const [products, documents, plans, exchanges] = await Promise.all([
      this.db.lamodaProduct.findMany({ where: { accountId: id }, include: { sku: { select: { id: true, name: true, internalSku: true } } }, orderBy: { remoteSku: 'asc' }, take: 1000 }),
      this.db.lamodaDocument.findMany({ where: { accountId: id }, orderBy: { syncedAt: 'desc' }, take: 500 }),
      this.db.lamodaPlan.findMany({ where: { accountId: id, ...warehouseScopeWhere(user) }, include: { warehouse: { select: { name: true } }, ...(lamodaAssemblyEnabled() ? { assembly: { select: { requestId: true } } } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.db.lamodaExchange.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 25 }),
    ]);
    return { products, documents, plans, exchanges, externalWritesEnabled: false, assemblyEnabled: lamodaAssemblyEnabled(), limits: { products: 1000, documents: 500, plans: 100 } };
  }
  async warehouses(id: string, user: AuthUser) {
    const c = await this.account(id, user, 'read');
    const links = await this.db.warehouseClient.findMany({ where: { clientId: c.clientId, status: 'ACTIVE', ...warehouseScopeWhere(user), warehouse: { isActive: true } }, select: { warehouse: { select: { id: true, name: true } } } });
    return links.map(row => row.warehouse);
  }
  async sync(id: string, kind: LamodaResource, user: AuthUser) {
    const c = await this.account(id, user, 'write');
    if (!lamodaResources.includes(kind)) throw new BadRequestException('Неизвестный вид загрузки.');
    if ((kind === 'FBO_SHIPMENTS' && !c.fboEnabled) || (['ORDERS', 'FBS_SHIPMENTS', 'RETURNS'].includes(kind) && !c.fbsEnabled)) throw new BadRequestException('Схема работы не включена в подключении.');
    const credentials = this.credentials(c), started = new Date(), syncToken = randomUUID();
    const lease = await this.db.lamodaAccount.updateMany({ where: { id, updatedAt: c.updatedAt, isActive: true, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: started } }] }, data: { syncLeaseUntil: new Date(started.getTime() + 5 * 60_000), syncToken } });
    if (lease.count !== 1) throw new ConflictException('Уже выполняется загрузка или подключение изменилось.');
    let exchangeId: string | undefined;
    try {
      // FIX: an expired lease can be recovered without leaving the old run permanently green/running.
      await this.db.lamodaExchange.updateMany({ where: { accountId: id, status: 'RUNNING', createdAt: { lt: started } }, data: { status: 'FAILED', errorCode: 'INTERRUPTED', finishedAt: started } });
      exchangeId = (await this.db.lamodaExchange.create({ data: { accountId: id, operation: kind } })).id;
      const params: Record<string, string> = {};
      const past = new Date(started.getTime() - 90 * 86400_000);
      if (kind === 'ORDERS') {
        params.updatedAtFrom = new Date(c.ordersSyncedAt ? c.ordersSyncedAt.getTime() - 5 * 60_000 : past.getTime()).toISOString();
        params.updatedAtTo = started.toISOString();
      } else if (kind !== 'CATALOG') {
        const fromKey = kind === 'RETURNS' ? 'returnDateFrom' : 'from';
        const toKey = kind === 'RETURNS' ? 'returnDateTo' : 'to';
        params[fromKey] = past.toISOString().slice(0, 10);
        params[toKey] = new Date(started.getTime() + 90 * 86400_000).toISOString().slice(0, 10);
      }
      const rows = await this.remote.collection(credentials, kind, params);
      // Parse the entire response before changing any cached records/cursors.
      // FIX: the official catalog contract permits sku:null for unfinished cards.
      const products = kind === 'CATALOG' ? rows.filter(row => row.sku !== null).map(productSnapshot) : [];
      const documents = kind !== 'CATALOG' ? rows.map(row => documentSnapshot(kind, row)) : [];
      const count = kind === 'CATALOG' ? products.length : documents.length;
      const skipped = rows.length - count;
      const keys = kind === 'CATALOG' ? products.map(p => p.remoteSku) : documents.map(d => d.remoteId);
      if (new Set(keys).size !== keys.length) throw new LamodaApiError('DUPLICATE_REMOTE_ID');
      await this.db.$transaction(async tx => {
        const locked = await tx.lamodaAccount.updateMany({ where: { id, syncToken, isActive: true, syncLeaseUntil: { gt: new Date() } }, data: { syncLeaseUntil: new Date(Date.now() + 60_000) } });
        if (locked.count !== 1) throw new ConflictException('Загрузка устарела. Повторите проверку.');
        if (kind === 'CATALOG') {
          const previous = await tx.lamodaProduct.findMany({ where: { accountId: id } });
          const bySku = new Map(previous.map(p => [p.remoteSku, p]));
          await tx.lamodaProduct.updateMany({ where: { accountId: id }, data: { isPresent: false } });
          for (const product of products) {
            const old = bySku.get(product.remoteSku);
            const changed = old && (old.barcode !== product.barcode || old.externalSku !== product.externalSku || old.size !== product.size);
            await tx.lamodaProduct.upsert({ where: { accountId_remoteSku: { accountId: id, remoteSku: product.remoteSku } },
              create: { accountId: id, ...product, checkedAt: started },
              update: { ...product, checkedAt: started, isPresent: true, ...(changed ? { linkState: 'REVIEW', skuId: null } : {}) },
            });
          }
        }
        for (const document of documents) {
          await tx.lamodaDocument.upsert({ where: { accountId_kind_remoteId: { accountId: id, kind, remoteId: document.remoteId } },
            create: { accountId: id, kind, ...document, syncedAt: started }, update: { ...document, syncedAt: started } });
        }
        if (kind === 'ORDERS') await tx.lamodaAccount.update({ where: { id }, data: { ordersSyncedAt: started } });
        await tx.lamodaExchange.update({ where: { id: exchangeId! }, data: { status: 'SUCCEEDED', itemCount: count, finishedAt: new Date() } });
      }, { timeout: 120_000 });
      return { message: `Загрузка завершена: ${count} записей.${skipped ? ` Пропущено карточек без SKU Lamoda: ${skipped}.` : ''}`, count, skipped };
    } catch (error) {
      if (exchangeId) await this.db.lamodaExchange.update({ where: { id: exchangeId }, data: { status: 'FAILED', errorCode: error instanceof LamodaApiError ? error.code : 'LOCAL_ERROR', finishedAt: new Date() } });
      return this.fail(error);
    } finally {
      await this.db.lamodaAccount.updateMany({ where: { id, syncToken }, data: { syncLeaseUntil: null, syncToken: null } });
    }
  }
  async candidates(id: string, productId: string, user: AuthUser) {
    const c = await this.account(id, user, 'read');
    const p = await this.db.lamodaProduct.findFirst({ where: { id: productId, accountId: id, isPresent: true } });
    if (!p) throw new NotFoundException('Товар Lamoda не найден.');
    if (!p.barcode) return [];
    return this.db.sku.findMany({ where: { clientId: c.clientId, isDraft: false, barcodes: { some: { value: p.barcode } } },
      select: { id: true, internalSku: true, name: true, size: true, color: true, barcodes: { select: { value: true } } }, take: 100 });
  }
  async link(id: string, productId: string, skuId: string, user: AuthUser) {
    const c = await this.account(id, user, 'write');
    const candidates = await this.candidates(id, productId, user);
    if (!candidates.some(s => s.id === skuId)) throw new BadRequestException('Выберите товар этого клиента с тем же штрихкодом.');
    return this.db.$transaction(async tx => {
      const p = await tx.lamodaProduct.findFirst({ where: { id: productId, accountId: id, isPresent: true } });
      if (!p) throw new NotFoundException();
      const sku = await tx.sku.findFirst({ where: { id: skuId, clientId: c.clientId, isDraft: false, barcodes: { some: { value: p.barcode ?? '' } } } });
      if (!sku) throw new ConflictException('Карточка изменилась. Обновите соответствия.');
      const saved = await tx.lamodaProduct.update({ where: { id: productId }, data: { skuId, linkState: 'CONFIRMED' } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'LAMODA_PRODUCT_LINKED', entity: 'LamodaProduct', entityId: productId, payload: { clientId: c.clientId, skuId, previousSkuId: p.skuId } } });
      return saved;
    }, { isolationLevel: 'Serializable' });
  }
  async importPlan(id: string, body: { title: string; warehouseId: string; remoteShipmentId?: string }, buffer: Buffer, user: AuthUser) {
    const c = await this.account(id, user, 'write');
    if (!c.fboEnabled) throw new BadRequestException('FBO не включено.');
    const title = text(body.title, 'Название'), warehouseId = text(body.warehouseId, 'Филиал');
    assertWarehouseAccess(user, { warehouseId }, 'write');
    const warehouse = await this.db.warehouseClient.findFirst({ where: { clientId: c.clientId, warehouseId, status: 'ACTIVE', warehouse: { isActive: true } } });
    if (!warehouse) throw new BadRequestException('Клиент не активен в выбранном филиале.');
    const remoteShipmentId = body.remoteShipmentId ? text(body.remoteShipmentId, 'ID поставки') : null;
    if (remoteShipmentId && !await this.db.lamodaDocument.findUnique({ where: { accountId_kind_remoteId: { accountId: id, kind: 'FBO_SHIPMENTS', remoteId: remoteShipmentId } } })) throw new BadRequestException('Сначала загрузите поставку из Lamoda.');
    const items = parseLamodaPlan(buffer), importHash = planHash(items, title, remoteShipmentId);
    return this.db.lamodaPlan.upsert({ where: { accountId_warehouseId_importHash: { accountId: id, warehouseId, importHash } },
      create: { accountId: id, warehouseId, title, remoteShipmentId, importHash, items }, update: {} });
  }
  async availability(id: string, planId: string, user: AuthUser) {
    const c = await this.account(id, user, 'write');
    const plan = await this.db.lamodaPlan.findFirst({ where: { id: planId, accountId: id } });
    if (!plan) throw new NotFoundException('План не найден.');
    assertWarehouseAccess(user, plan, 'write');
    const lines = plan.items as unknown as LamodaPlanLine[];
    const products = await this.db.lamodaProduct.findMany({ where: { accountId: id, isPresent: true, linkState: 'CONFIRMED', skuId: { not: null }, barcode: { in: lines.map(l => l.barcode) } } });
    const unresolved: number[] = [];
    const grouped = new Map<string, { skuId: string; barcode: string; quantity: number }>();
    lines.forEach((line, index) => {
      const matches = products.filter(p => p.barcode === line.barcode && (!line.article || p.externalSku === line.article) && (!line.remoteSku || p.remoteSku === line.remoteSku));
      // Several Lamoda identities sharing one barcode must be resolved before warehouse assembly.
      if (matches.length !== 1 || !matches[0].skuId) { unresolved.push(index + 2); return; }
      const skuId = matches[0].skuId;
      const old = grouped.get(skuId);
      grouped.set(skuId, { skuId, barcode: line.barcode, quantity: (old?.quantity ?? 0) + line.quantity });
    });
    const availability = grouped.size ? await this.requests.previewAvailability({ clientId: c.clientId, warehouseId: plan.warehouseId, type: 'OUTBOUND', items: [...grouped.values()] }, user) : null;
    return { unresolvedRows: unresolved, availability, canAssemble: lamodaAssemblyEnabled() && !unresolved.length, message: 'Предварительный расчёт FBO. Черновик не резервирует товар. Перед запуском сборки потребуется повторная проверка.' };
  }
  async importShipment(id:string,body:{reference:string;warehouseId:string;title?:string},user:AuthUser) {
    const c=await this.account(id,user,'write');
    if(!c.fboEnabled||!c.isActive) throw new BadRequestException('Нужно активное подключение FBO.');
    assertWarehouseAccess(user,body,'write');
    if(!await this.db.warehouseClient.findFirst({where:{clientId:c.clientId,warehouseId:body.warehouseId,status:'ACTIVE',warehouse:{isActive:true}}})) throw new BadRequestException('Клиент не активен в выбранном филиале.');
    const remoteId=lamodaShipmentId(body.reference);
    const {shipment,items}=await this.remote.fboShipment(this.credentials(c),remoteId);
    this.assertShipmentOpen(shipment);
    const lines=lamodaShipmentLines(items,text(shipment.warehouseCode,'Склад Lamoda'));
    const title=body.title?.trim()?text(body.title,'Название'):`Lamoda · ${remoteId}`;
    const importHash=planHash(lines,title,remoteId);
    return this.db.lamodaPlan.upsert({where:{accountId_warehouseId_importHash:{accountId:id,warehouseId:body.warehouseId,importHash}},create:{accountId:id,warehouseId:body.warehouseId,title,remoteShipmentId:remoteId,importHash,items:lines},update:{}});
  }
  private assertShipmentOpen(shipment:Record<string,unknown>) {
    if(!['NEW','CONFIRMED','DRAFT','VALIDATION','READY_FOR_SHIPMENT'].includes(String(shipment.status))) throw new ConflictException(`Поставка Lamoda недоступна для новой сборки: ${String(shipment.status)}.`);
  }
  async createAssembly(id:string,planId:string,user:AuthUser) {
    const c=await this.account(id,user,'write');
    if(!lamodaAssemblyEnabled()) throw new BadRequestException('Создание сборок Lamoda пока выключено.');
    if(!user.permissionCodes.some(p=>['system:admin','client-requests:write'].includes(p))) throw new ForbiddenException('Нужны права создания складских заявок.');
    if(!c.isActive||!c.fboEnabled) throw new BadRequestException('Нужно активное подключение FBO.');
    const plan=await this.db.lamodaPlan.findFirst({where:{id:planId,accountId:id}});
    if(!plan) throw new NotFoundException('План не найден.');
    assertWarehouseAccess(user,plan,'write');
    const previous=await this.db.lamodaFboAssembly.findUnique({where:{planId},include:{request:{select:{id:true,number:true}}}});
    if(previous) return previous.request;
    // FIX: remote-linked Excel and URL imports must still match the current Lamoda plan.
    const lines=plan.items as unknown as LamodaPlanLine[];
    let remoteLines:LamodaPlanLine[]|null=null;
    if(plan.remoteShipmentId) {
      const remote=await this.remote.fboShipment(this.credentials(c),plan.remoteShipmentId);
      this.assertShipmentOpen(remote.shipment);
      remoteLines=lamodaShipmentLines(remote.items,text(remote.shipment.warehouseCode,'Склад Lamoda'));
    }
    try { return await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "LamodaPlan" WHERE "id"=${planId} FOR UPDATE`;
      const old=await tx.lamodaFboAssembly.findUnique({where:{planId},include:{request:{select:{id:true,number:true}}}});
      if(old) return old.request;
      const current=await tx.lamodaAccount.findFirst({where:{id,updatedAt:c.updatedAt,isActive:true,fboEnabled:true}});
      if(!current) throw new ConflictException('Подключение изменилось. Повторите проверку.');
      if(!await tx.warehouseClient.findFirst({where:{clientId:c.clientId,warehouseId:plan.warehouseId,status:'ACTIVE',warehouse:{isActive:true}}})) throw new BadRequestException('Клиент не активен в филиале.');
      const products=await tx.lamodaProduct.findMany({where:{accountId:id,isPresent:true,linkState:'CONFIRMED',barcode:{in:lines.map(l=>l.barcode)}}});
      const resolved=resolveLamodaLines(lines,products);
      if(remoteLines) {
        const remoteResolved=resolveLamodaLines(remoteLines,products);
        const fingerprint=(items:typeof resolved.items)=>JSON.stringify(items.map(i=>[i.skuId,i.quantity]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
        if(fingerprint(remoteResolved.items)!==fingerprint(resolved.items)) throw new ConflictException('Состав изменился в Lamoda. Загрузите поставку заново.');
      }
      const skus=await tx.sku.findMany({where:{id:{in:resolved.items.map(i=>i.skuId)},clientId:c.clientId,isDraft:false},include:{barcodes:true}});
      if(resolved.items.some(i=>!skus.some(s=>s.id===i.skuId&&s.barcodes.some(b=>b.value===i.barcode)))) throw new ConflictException('Карточки WMS изменились. Проверьте соответствия.');
      const request=await tx.clientRequest.create({data:{clientId:c.clientId,warehouseId:plan.warehouseId,type:'OUTBOUND',status:'SUBMITTED',priority:'NORMAL',title:plan.title,destinationCity:resolved.directions.map(d=>d.name).join(', '),createdByUserId:user.id,items:{create:resolved.items}},select:{id:true,number:true}});
      await tx.lamodaFboAssembly.create({data:{requestId:request.id,planId,externalKey:plan.remoteShipmentId?JSON.stringify([c.sellerId,plan.remoteShipmentId]):null,directions:resolved.directions}});
      await tx.clientRequestEvent.create({data:{requestId:request.id,clientId:c.clientId,eventType:'CREATED',title:'Сборка Lamoda создана',statusTo:'SUBMITTED',createdByUserId:user.id}});
      return request;
    },{isolationLevel:'Serializable',timeout:30000}); }
    catch(error) {
      if(['P2002','P2034'].includes((error as {code?:string}).code??'')) throw new ConflictException('Сборка уже создаётся или поставка уже привязана. Обновите список.');
      throw error;
    }
  }
}
