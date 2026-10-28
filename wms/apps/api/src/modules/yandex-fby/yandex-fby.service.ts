import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { ClientRequestsService } from '../client-requests/client-requests.service';
import { assertWarehouseAccess, effectiveWarehouseId, warehouseScopeWhere } from '../client-requests/client-request-warehouse-scope';
import { YandexFbyClient, type Supply } from './yandex-fby-client';
import { assertFbySupply, fbyCompositionHash, normalizeFbyLines } from './yandex-fby-policy';
import { FbyPreviewDto, FbyCreateDto, FbyBindDto } from './yandex-fby.dto';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class YandexFbyService {
  private readonly remote = new YandexFbyClient();
  constructor(private readonly db: PrismaService, private readonly scopes: ClientScopeService, private readonly requests: ClientRequestsService) {}
  private guard(user: AuthUser, mode: 'read' | 'write') {
    if (process.env.WMS_YANDEX_FBY_ENABLED !== 'true') throw new NotFoundException();
    if (!user.permissionCodes.some(p => p === 'system:admin' || p === `client-requests:${mode}`)) throw new ForbiddenException();
    if (mode === 'write' && user.isDemo) throw new ForbiddenException('В демо изменения недоступны.');
  }
  private async account(id: string, user: AuthUser, mode: 'read' | 'write') {
    this.guard(user, mode);
    const c = await this.db.clientMarketplaceConnection.findFirst({ where: { id, marketplace: 'YANDEX_MARKET', isActive: true } });
    if (!c) throw new NotFoundException('Активное подключение Яндекса не найдено.');
    this.scopes.requireClientAccess(user, c.clientId, mode);
    return c;
  }
  async accounts(clientId: string, user: AuthUser) {
    this.guard(user, 'read'); this.scopes.requireClientAccess(user, clientId, 'read');
    return this.db.clientMarketplaceConnection.findMany({ where: { clientId, marketplace: 'YANDEX_MARKET', isActive: true },
      select: { id: true, accountName: true, sellerId: true, client: { select: { name: true } } } });
  }
  async warehouses(id: string, user: AuthUser, mode: 'read' | 'write' = 'read') {
    const c = await this.account(id, user, mode);
    const fixed = effectiveWarehouseId(user, mode) ?? (!user.roleCodes.includes('CLIENT') ? user.activeWarehouseId : null);
    const rows = await this.db.warehouseClient.findMany({ where: { clientId: c.clientId, status: 'ACTIVE', ...(fixed ? { warehouseId: fixed } : {}), warehouse: { isActive: true } }, select: { warehouse: { select: { id: true, name: true } } } });
    return rows.map(r => r.warehouse);
  }
  async list(id: string, user: AuthUser, view: string) {
    const c = await this.account(id, user, 'read');
    const closed = ['DONE', 'CANCELLED', 'REJECTED'] as const;
    return this.db.clientRequest.findMany({ where: { clientId: c.clientId, ...warehouseScopeWhere(user), yandexFbyShipment: { is: { connectionId: id } }, status: view === 'closed' ? { in: [...closed] } : { notIn: [...closed] } },
      select: { id: true, number: true, title: true, status: true, warehouseId: true, destinationCity: true, desiredDate: true, items: { select: { quantity: true } }, yandexFbyShipment: { select: { remoteNumber: true, remoteStatus: true, checkedAt: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }
  async parse(id: string, buffer: Buffer, user: AuthUser) {
    await this.account(id, user, 'write');
    let rows: unknown[][];
    try { const book = XLSX.read(buffer, { type: 'buffer', sheetRows: 1002 }); rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: false, defval: '' }); }
    catch { throw new BadRequestException('Не удалось прочитать Excel.'); }
    if (rows[0]?.[0] !== 'ШК' || rows[0]?.[1] !== 'Количество') throw new BadRequestException('Первые колонки: ШК, Количество.');
    return normalizeFbyLines(rows.slice(1).filter(r => r.some(v => String(v).trim())).map(r => ({ barcode: String(r[0] ?? '').trim(), quantity: Number(r[1]) })));
  }
  async preview(id: string, dto: FbyPreviewDto, user: AuthUser, excludeRequestId?: string) {
    const c = await this.account(id, user, 'write');
    if (!(await this.warehouses(id, user, 'write')).some(w => w.id === dto.warehouseId)) throw new ForbiddenException('Филиал недоступен.');
    let supply: Supply | null = null;
    let source: Array<{ offerId?: string; barcode: string; name?: string; quantity: number }>;
    if (dto.reference) {
      supply = await this.remote.supply(c, dto.reference); assertFbySupply(supply);
      const items = await this.remote.items(c, supply.id.id);
      const mappings = new Map((dto.mappings ?? []).map(m => [m.offerId, m.barcode]));
      if (mappings.size !== (dto.mappings ?? []).length) throw new BadRequestException('Повторяется сопоставление артикула.');
      source = items.map(i => ({ offerId: i.offerId, name: i.name, quantity: i.counters.planCount, barcode: mappings.get(i.offerId) ?? '' }));
      if (!source.length || source.length > 1000) throw new BadRequestException('В поставке должно быть от 1 до 1000 товаров.');
    } else source = normalizeFbyLines(dto.items);
    // FIX: remote offer IDs are not barcodes. Resolve only explicit same-client barcode mappings.
    const matches = await this.db.barcode.findMany({ where: { value: { in: source.map(r => r.barcode).filter(Boolean) }, sku: { clientId: c.clientId, isDraft: false } }, include: { sku: true } });
    const lines = source.map(row => {
      const found = matches.filter(m => m.value === row.barcode);
      const sku = new Set(found.map(m => m.skuId)).size === 1 ? found[0]?.sku : null;
      return { ...row, skuId: sku?.id ?? null, name: sku?.name ?? row.name ?? '', size: sku?.size ?? null, resolved: !!sku };
    });
    const complete = lines.every(r => r.resolved);
    const grouped = new Map<string, { skuId: string; barcode: string; name: string; quantity: number }>();
    for (const line of lines.filter(r => r.skuId)) {
      const existing = grouped.get(line.skuId!);
      if (existing) existing.quantity += line.quantity;
      else grouped.set(line.skuId!, { skuId: line.skuId!, barcode: line.barcode, name: line.name, quantity: line.quantity });
    }
    const items = [...grouped.values()];
    if (items.some(i => i.quantity > 1_000_000)) throw new BadRequestException('Слишком большое количество одного товара.');
    const destination = (supply?.transitLocation?.name ?? supply?.targetLocation?.name ?? dto.destination ?? '').trim();
    const date = supply?.transitLocation?.requestedDate ?? supply?.targetLocation?.requestedDate;
    if (date && !Number.isFinite(Date.parse(date))) throw new BadRequestException('В поставке некорректная дата.');
    const availability = complete ? await this.requests.previewAvailability({ clientId: c.clientId, warehouseId: dto.warehouseId, type: 'OUTBOUND', items, excludeRequestId }, user) : null;
    const previewHash = hash([id, dto.warehouseId, supply?.id.id ?? null, supply?.status ?? null, destination, date ?? null, lines.map(r => [r.offerId, r.skuId, r.barcode, r.quantity])]);
    return { lines, items, supply, destination, desiredDate: date ?? null, previewHash, availability, canCreate: complete && !!destination && !!availability?.canCommit };
  }
  async create(id: string, dto: FbyCreateDto, user: AuthUser) {
    const c = await this.account(id, user, 'write');
    const p = await this.preview(id, dto, user);
    const importKey = p.supply ? `yandex:${id}:${p.supply.id.id}` : `yandex:${id}:manual:${dto.idempotencyKey}`;
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${importKey}))`;
      const prior = await tx.yandexFbyShipment.findFirst({ where: { OR: [{ importKey }, ...(p.supply ? [{ connectionId: id, remoteId: String(p.supply.id.id) }] : [])] }, include: { request: true } });
      if (prior) {
        assertWarehouseAccess(user, prior.request, 'write');
        if (prior.request.warehouseId !== dto.warehouseId) throw new ConflictException('Поставка уже связана со сборкой в другом филиале.');
        if (!p.supply && (prior.snapshot as any)?.previewHash !== p.previewHash) throw new ConflictException('Повторный запрос содержит другой состав.');
        return { request: prior.request, existing: true };
      }
      if (p.previewHash !== dto.previewHash) throw new ConflictException('Состав изменился. Повторите проверку.');
      if (!p.canCreate) throw new BadRequestException('Проверьте сопоставления, место отгрузки и доступные остатки.');
      const request = await tx.clientRequest.create({ data: { clientId: c.clientId, warehouseId: dto.warehouseId, type: 'OUTBOUND', title: dto.title?.trim() || `FBY Яндекс · ${p.supply?.id.marketplaceRequestId ?? 'сборка'}`, destinationCity: p.destination, desiredDate: p.desiredDate ? new Date(p.desiredDate) : null, createdByUserId: user.id,
        items: { create: p.items }, yandexFbyShipment: { create: { connectionId: id, importKey, snapshot: json(p), ...this.remoteFields(p) } },
        events: { create: { clientId: c.clientId, eventType: 'CREATED', title: 'Создана сборка FBY Яндекс', statusTo: 'SUBMITTED', createdByUserId: user.id } } } });
      return { request, existing: false };
    });
  }
  private remoteFields(p: Awaited<ReturnType<YandexFbyService['preview']>>) {
    return p.supply ? { remoteId: String(p.supply.id.id), remoteNumber: p.supply.id.marketplaceRequestId ?? p.supply.id.warehouseRequestId ?? String(p.supply.id.id), remoteStatus: p.supply.status, snapshot: json(p), checkedAt: new Date() } : {};
  }
  async bind(id: string, requestId: string, dto: FbyBindDto, user: AuthUser) {
    const c = await this.account(id, user, 'write');
    const r = await this.db.clientRequest.findFirst({ where: { id: requestId, clientId: c.clientId, yandexFbyShipment: { is: { connectionId: id } } }, include: { items: true, yandexFbyShipment: true } });
    if (!r) throw new NotFoundException(); assertWarehouseAccess(user, r, 'write');
    if (!dto.reference || dto.warehouseId !== r.warehouseId) throw new BadRequestException('Укажите поставку и филиал сборки.');
    const p = await this.preview(id, dto, user, requestId);
    if (p.previewHash !== dto.previewHash || p.lines.some(l => !l.resolved)) throw new ConflictException('Повторите проверку состава.');
    if (fbyCompositionHash(r.items.map(i => ({ skuId: i.skuId!, quantity: i.quantity }))) !== fbyCompositionHash(p.items)) throw new ConflictException('Состав поставки не совпадает со сборкой. Сборка не изменена.');
    return this.db.$transaction(async tx => {
      // FIX: serialize binding with imports of the same external supply.
      const importKey = `yandex:${id}:${p.supply!.id.id}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${importKey}))`;
      const prior = await tx.yandexFbyShipment.findFirst({ where: { connectionId: id, remoteId: String(p.supply!.id.id) } });
      if (prior) throw new ConflictException('Эта поставка уже привязана к сборке.');
      await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${requestId} FOR UPDATE`;
      const current = await tx.clientRequest.findUniqueOrThrow({ where: { id: requestId }, include: { items: true, yandexFbyShipment: true } });
      if (['DONE','CANCELLED','REJECTED'].includes(current.status) || current.yandexFbyShipment?.remoteId || current.updatedAt.getTime() !== r.updatedAt.getTime()) throw new ConflictException('Заявка изменилась или уже привязана.');
      await tx.yandexFbyShipment.update({ where: { requestId }, data: this.remoteFields(p) });
      await tx.clientRequestEvent.create({ data: { requestId, clientId: c.clientId, eventType: 'COMMENT', title: `Привязана поставка Яндекс ${p.supply!.id.marketplaceRequestId}`, createdByUserId: user.id } });
      return { request: current };
    });
  }
  async refresh(id: string, requestId: string, user: AuthUser) {
    const c = await this.account(id, user, 'read');
    const s = await this.db.yandexFbyShipment.findFirst({ where: { requestId, connectionId: id }, include: { request: { include: { items: true } } } });
    if (!s?.remoteNumber) throw new NotFoundException('Сначала привяжите поставку.');
    assertWarehouseAccess(user, s.request, 'read');
    const supply = await this.remote.supply(c, s.remoteNumber);
    if (String(supply.id.id) !== s.remoteId) throw new ConflictException('Номер теперь относится к другой поставке.');
    const items = await this.remote.items(c, supply.id.id);
    const old = (s.snapshot as any)?.lines as Array<{ offerId?: string; quantity: number }> | undefined;
    const before = new Map((old ?? []).filter(l => l.offerId).map(l => [l.offerId!, l.quantity]));
    const after = new Map(items.map(i => [i.offerId, i.counters.planCount]));
    const differences = [...new Set([...before.keys(), ...after.keys()])].filter(key => before.get(key) !== after.get(key)).map(offerId => ({ offerId, assemblyQuantity: before.get(offerId) ?? 0, yandexQuantity: after.get(offerId) ?? 0 }));
    // FIX: remote refresh is read-only and cannot replace picked/packed demand.
    return { status: supply.status, checkedAt: new Date().toISOString(), differences, matches: !differences.length };
  }
}
