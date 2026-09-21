import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { WmsStockAvailabilityService } from '../stock/wms-stock-availability.service';
import { allocationEligibility, splitMarketplaceStock, validateAllocationDraft, type AllocationProduct } from './marketplace-allocation';
import { MarketplaceConnectionsService } from './marketplace-connections.service';

const PREFIX = 'marketplace.allocation.draft.';
@Injectable()
export class MarketplaceAllocationService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService,
    private readonly availability: WmsStockAvailabilityService,
    private readonly marketplaces: MarketplaceConnectionsService) {}

  private catalogKey(clientId: string, connectionId: string) { return `marketplace.allocation.catalog.${clientId}.${connectionId}`; }
  private bindingPrefix(clientId: string) { return `marketplace.allocation.binding.${clientId}.`; }

  async catalog(clientId: string, body: { draft?: unknown }, user: AuthUser) {
    this.authorize(clientId, user);
    let draft;
    try { draft = validateAllocationDraft(body?.draft, await this.connections(clientId)); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    const [wb, ozon] = await Promise.all([
      this.marketplaces.readAllocationCatalog(clientId, draft.wbConnectionId, user),
      this.marketplaces.readAllocationCatalog(clientId, draft.ozonConnectionId, user),
    ]);
    const createdAt = new Date().toISOString();
    // FIX: cache independent cabinet snapshots; this never runs the old SKU-upsert synchronizer.
    for (const [connectionId, products] of [[draft.wbConnectionId, wb], [draft.ozonConnectionId, ozon]] as const) {
      const key = this.catalogKey(clientId, connectionId);
      const value = { createdAt, products } as unknown as Prisma.InputJsonValue;
      await this.prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    const bindings = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: this.bindingPrefix(clientId) } } });
    return { wb, ozon, createdAt, bindings: bindings.map(row => ({ ...(row.value as object), revision: row.updatedAt.toISOString() })) };
  }

  async confirmBinding(clientId: string, body: { draft?: unknown; sourceBarcode?: string; wbProductId?: string;
    ozonProductId?: string; confirmed?: boolean; revision?: string | null }, user: AuthUser) {
    this.authorize(clientId, user, true);
    if (!body || body.confirmed !== true || typeof body.sourceBarcode !== 'string' || !body.sourceBarcode.trim()
      || body.sourceBarcode.length > 150 || (body.revision !== null && typeof body.revision !== 'string')) {
      throw new BadRequestException('Выберите исходный ШК, обе карточки и явно подтвердите соответствие.');
    }
    const sourceBarcode = body.sourceBarcode.trim();
    const prefix = this.bindingPrefix(clientId);
    const key = prefix + createHash('sha256').update(sourceBarcode).digest('hex');
    return this.prisma.$transaction(async tx => {
      // One lock for all source mappings prevents reusing a target card under two physical barcodes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;
      const connections = await tx.clientMarketplaceConnection.findMany({ where: { clientId, isActive: true },
        select: { id: true, marketplace: true, isActive: true } });
      let draft;
      try { draft = validateAllocationDraft(body.draft, connections); }
      catch (error) { throw new BadRequestException((error as Error).message); }
      const source = await tx.barcode.findFirst({ where: { value: sourceBarcode, sku: { clientId } }, select: { id: true } });
      if (!source) throw new BadRequestException('Исходный ШК отсутствует в карточках этого клиента.');
      const readProduct = async (connectionId: string, productId: string | undefined) => {
        const snapshot = await tx.systemSetting.findUnique({ where: { key: this.catalogKey(clientId, connectionId) } });
        const value = snapshot?.value as unknown as { createdAt: string; products: AllocationProduct[] } | undefined;
        if (!value || !Number.isFinite(Date.parse(value.createdAt)) || Date.now() - Date.parse(value.createdAt) > 15 * 60_000) {
          throw new ConflictException('Обновите каталоги: срок проверки карточек истёк.');
        }
        const matches = value.products.filter(row => row.productId === productId);
        if (matches.length !== 1) throw new BadRequestException('Карточка не найдена однозначно в выбранном кабинете.');
        return matches[0];
      };
      const wb = await readProduct(draft.wbConnectionId, body.wbProductId);
      const ozon = await readProduct(draft.ozonConnectionId, body.ozonProductId);
      const current = await tx.systemSetting.findUnique({ where: { key } });
      if ((current?.updatedAt.toISOString() ?? null) !== body.revision) throw new ConflictException('Соответствие уже изменено. Обновите каталоги.');
      const others = await tx.systemSetting.findMany({ where: { key: { startsWith: prefix, not: key } } });
      for (const other of others) {
        const value = other.value as any;
        if ((value.wbConnectionId === draft.wbConnectionId && value.wb?.productId === wb.productId)
          || (value.ozonConnectionId === draft.ozonConnectionId && value.ozon?.productId === ozon.productId)) {
          throw new ConflictException('Одна из карточек уже связана с другим исходным ШК.');
        }
      }
      const value = { sourceBarcode, wbConnectionId: draft.wbConnectionId, ozonConnectionId: draft.ozonConnectionId,
        wb, ozon, confirmedByUserId: user.id, confirmedAt: new Date().toISOString() };
      const json = value as unknown as Prisma.InputJsonValue;
      const saved = await tx.systemSetting.upsert({ where: { key }, create: { key, value: json, updatedByUserId: user.id },
        update: { value: json, updatedByUserId: user.id, updatedAt: new Date(Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1)) } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'marketplace.allocation.binding.confirmed', entity: 'Client',
        entityId: clientId, payload: { before: current?.value ?? null, after: json } } });
      return { ...value, revision: saved.updatedAt.toISOString() };
    });
  }

  // FIX: default off isolates the sold VM; this stage is explicitly preparation, not publication.
  capabilities() { return { enabled: process.env.WMS_MARKETPLACE_ALLOCATION_ENABLED === 'true', publicationEnabled: false }; }

  private authorize(clientId: string, user: AuthUser, write = false) {
    if (!this.capabilities().enabled || user.isDemo) throw new ForbiddenException('Распределение между маркетплейсами недоступно.');
    if (!clientId?.trim()) throw new BadRequestException('Выберите клиента.');
    this.scopes.requireClientAccess(user, clientId, write && !user.roleCodes.includes('CLIENT') ? 'write' : 'read');
  }

  private connections(clientId: string) {
    return this.prisma.clientMarketplaceConnection.findMany({
      where: { clientId, isActive: true, marketplace: { in: ['WILDBERRIES', 'OZON'] } },
      select: { id: true, marketplace: true, isActive: true, accountName: true, fbsExecutionWarehouseId: true },
      orderBy: [{ marketplace: 'asc' }, { id: 'asc' }],
    });
  }

  async read(clientId: string, user: AuthUser) {
    this.authorize(clientId, user);
    const [connections, setting] = await Promise.all([
      this.connections(clientId), this.prisma.systemSetting.findUnique({ where: { key: PREFIX + clientId } }),
    ]);
    let draft = null;
    try { draft = validateAllocationDraft(setting?.value, connections); } catch { /* Disconnected cabinets invalidate old drafts. */ }
    return { ...allocationEligibility(connections), connections, draft, revision: setting?.updatedAt.toISOString() ?? null,
      publicationEnabled: false, invalidated: Boolean(setting && !draft) };
  }

  async save(clientId: string, body: { draft?: unknown; revision?: unknown }, user: AuthUser) {
    this.authorize(clientId, user, true);
    if (!body || typeof body !== 'object') throw new BadRequestException('Передайте настройки распределения.');
    if (body.revision !== null && typeof body.revision !== 'string') throw new BadRequestException('Передайте версию настроек.');
    const key = PREFIX + clientId;
    // FIX: advisory transaction lock plus revision protects the first insert and concurrent edits.
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const connections = await tx.clientMarketplaceConnection.findMany({ where: { clientId, isActive: true },
        select: { id: true, marketplace: true, isActive: true } });
      let draft;
      try { draft = validateAllocationDraft(body.draft, connections); }
      catch (error) { throw new BadRequestException((error as Error).message); }
      const previous = await tx.systemSetting.findUnique({ where: { key } });
      if ((previous?.updatedAt.toISOString() ?? null) !== body.revision) throw new ConflictException('Настройки изменились. Обновите раздел.');
      const saved = await tx.systemSetting.upsert({ where: { key },
        create: { key, value: draft, updatedByUserId: user.id }, update: { value: draft, updatedByUserId: user.id,
          updatedAt: new Date(Math.max(Date.now(), (previous?.updatedAt.getTime() ?? 0) + 1)) } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'marketplace.allocation.draft.saved',
        entity: 'Client', entityId: clientId, payload: { before: previous?.value ?? null, after: draft } as Prisma.InputJsonValue } });
      return { draft, revision: saved.updatedAt.toISOString(), publicationEnabled: false };
    });
  }

  async preview(clientId: string, body: { draft?: unknown; search?: string; page?: number }, user: AuthUser) {
    this.authorize(clientId, user);
    if (!body || typeof body !== 'object') throw new BadRequestException('Передайте параметры предпросмотра.');
    const connections = await this.connections(clientId);
    let draft;
    try { draft = validateAllocationDraft(body.draft, connections); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    const wb = connections.find(c => c.id === draft.wbConnectionId)!;
    const ozon = connections.find(c => c.id === draft.ozonConnectionId)!;
    // FIX: never present a combined stock from unrelated or unspecified physical warehouses.
    if (!wb.fbsExecutionWarehouseId || wb.fbsExecutionWarehouseId !== ozon.fbsExecutionWarehouseId) {
      throw new BadRequestException('Для общего остатка у обоих кабинетов должен быть задан один склад исполнения WMS.');
    }
    if (!user.roleCodes.includes('CLIENT') && !user.permissionCodes.includes('system:admin')
      && (user.activeWarehouseId !== wb.fbsExecutionWarehouseId
        || (user.warehouseIds && !user.warehouseIds.includes(wb.fbsExecutionWarehouseId)))) {
      throw new ForbiddenException('Выберите доступный общий филиал исполнения этих кабинетов.');
    }
    if ((body.page !== undefined && (!Number.isInteger(body.page) || body.page < 1))
      || (body.search !== undefined && typeof body.search !== 'string')) throw new BadRequestException('Неверные параметры поиска.');
    const snapshot = await this.availability.snapshot(clientId, user, { warehouseId: wb.fbsExecutionWarehouseId });
    const search = (body.search ?? '').trim().slice(0, 100);
    const rows = snapshot.rows.filter(row => row.barcode.includes(search));
    const page = body.page ?? 1, pageSize = 50;
    return { generatedAt: snapshot.generatedAt, warehouseId: wb.fbsExecutionWarehouseId,
      totalRows: rows.length, page, pageSize, missingBarcodeCount: snapshot.missingBarcodeCount,
      rows: rows.slice((page - 1) * pageSize, page * pageSize).map(row => ({ ...row, ...splitMarketplaceStock(row.available, draft.wbPercent) })),
      publicationEnabled: false };
  }
}
