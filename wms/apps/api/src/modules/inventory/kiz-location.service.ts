import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { storageBoxTransferKizIdentity } from '../stock/stock-operations.service';
import { inspectKizReuse, kizReuseEnabled, kizReuseMessage } from '../../common/kiz-wb-reuse';
import { KizReviewQueue, kizReviewEnabled } from '../../common/kiz-review-queue';

@Injectable()
export class KizLocationService {
  constructor(private readonly prisma: PrismaService, private readonly clients: ClientScopeService) {}
  reviews(user: AuthUser, cursor?: string) { return new KizReviewQueue(this.prisma,this.clients).list(user,cursor); }
  decideReview(id: string, resolution: 'REUSE'|'RELABEL', reason: string, confirmed: boolean, user: AuthUser) {
    return new KizReviewQueue(this.prisma,this.clients).decide(id,resolution,reason,confirmed,user);
  }
  async lookup(kiz: string, user: AuthUser) {
    // FIX: read-only administrator feature, isolated from sold installations and scoped before lookup.
    if (process.env.WMS_KIZ_LOCATION_CHECK_ENABLED !== 'true' || user.isDemo ||
        !user.roleCodes.some(role => ['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(role))) {
      throw new ForbiddenException('Проверка КИЗ доступна администратору и владельцу при включённом сервисе.');
    }
    const warehouseId = user.activeWarehouseId;
    if (!warehouseId) throw new BadRequestException('Сначала выберите филиал.');
    // FIX: honor the auth module's global warehouse permission while retaining selected-warehouse/client query scope.
    if (!user.permissionCodes.includes('system:admin') && user.warehouseIds && !user.warehouseIds.includes(warehouseId)) {
      throw new ForbiddenException('Нет доступа к выбранному филиалу.');
    }
    const raw = typeof kiz === 'string' ? kiz.trim() : '';
    const parsed = raw.length <= 1024 ? storageBoxTransferKizIdentity(raw) : null;
    if (!parsed) throw new BadRequestException('Отсканируйте полный КИЗ Data Matrix, а не штрихкод товара.');
    const { gtin, serial } = parsed;
    const identity = `01${gtin}21${serial}`;
    const prefixes = [identity, `]d2${identity}`, `]D2${identity}`, `(01)${gtin}(21)${serial}`,
      `01${gtin}\u001d21${serial}`, `]d201${gtin}\u001d21${serial}`, `01${gtin}<GS>21${serial}`, `]d201${gtin}<GS>21${serial}`];
    const clientId = this.clients.resolveClientFilter(user);
    const records = await this.prisma.productMark.findMany({
      where: { clientId, AND: [
        { OR: prefixes.map(prefix => ({ value: { startsWith: prefix } })) },
        { OR: [{ box: { warehouseId } }, { boxId: null, stockMovement: { warehouseId } }] },
      ] },
      include: {
        sku: { select: { id: true, name: true, article: true, size: true, color: true } },
        client: { select: { name: true } },
        box: { select: { id: true, code: true, clientId: true, warehouseId: true, status: true,
          warehouse: { select: { name: true } }, zone: { select: { name: true, warehouseId: true } },
          pallet: { select: { code: true, clientId: true, zone: { select: { name: true, warehouseId: true } } } } } },
        stockMovement: { select: { warehouseId: true, warehouse: { select: { name: true } } } },
      }, orderBy: { id: 'asc' }, take: 51,
    });
    if (records.length > 50) throw new ConflictException('Слишком много записей для этого КИЗ. Нужна проверка дублей.');
    // FIX: prefix search is only a database prefilter; serial identity must match exactly.
    const marks = records.filter(mark => {
      const value = storageBoxTransferKizIdentity(mark.value);
      return value?.gtin === gtin && value.serial === serial;
    });
    const boxes = marks.flatMap(mark => mark.box ? [mark.box] : []);
    const placements = boxes.length ? await this.prisma.storagePalletBox.findMany({
      where: { OR: [{ boxId: { in: boxes.map(box => box.id) } }, { boxCode: { in: boxes.map(box => box.code) } }],
        pallet: { warehouseId, clientId } },
      select: { boxId: true, boxCode: true, pallet: { select: { code: true, clientId: true, warehouseId: true,
        zone: { select: { name: true, warehouseId: true } } } } },
    }) : [];
    const matches = await Promise.all(marks.map(async mark => {
      const box = mark.box;
      const placement = box ? placements.find(p => p.pallet.clientId === mark.clientId && p.pallet.warehouseId === warehouseId &&
        (p.boxId === box.id || (!p.boxId && p.boxCode === box.code))) : null;
      const boxIsConsistent = box?.clientId === mark.clientId && box.warehouseId === warehouseId;
      const legacy = boxIsConsistent && !placement && box?.pallet?.clientId === mark.clientId ? box.pallet : null;
      const room = placement?.pallet.zone ?? legacy?.zone ?? (boxIsConsistent ? box?.zone : null);
      // FIX: history survives AVAILABLE restoration; show only requests inside the selected branch.
      const evidence = kizReuseEnabled() ? await inspectKizReuse(this.prisma, mark.clientId, mark.value) : null;
      const reuse = evidence ? { ...evidence, message: evidence.history.length ? kizReuseMessage(evidence.decision) : 'История использования в WB не найдена.',
        history: evidence.history.filter(h => h.request?.warehouseId === warehouseId),
        orders: evidence.orders.filter(o => evidence.history.some(h => h.orderId === o.orderId && h.request?.warehouseId === warehouseId)) } : undefined;
      return {
        id: mark.id, product: mark.sku, client: mark.client.name, status: mark.status,
        reuse,
        boxCode: boxIsConsistent ? box!.code : null, boxStatus: boxIsConsistent ? box!.status : null,
        palletCode: boxIsConsistent ? placement?.pallet.code ?? legacy?.code ?? null : null,
        room: boxIsConsistent && room?.warehouseId === warehouseId ? room.name : null,
        warehouse: boxIsConsistent ? box?.warehouse?.name ?? null : !box ? mark.stockMovement?.warehouse?.name ?? null : null,
        locationWarning: box && !boxIsConsistent ? 'Принадлежность короба не совпадает с КИЗ. Нужна проверка.' : null,
      };
    }));
    const reviews=kizReviewEnabled() ? await new KizReviewQueue(this.prisma,this.clients).unitChoices(identity,user) : undefined;
    return { found: matches.length > 0, ambiguous: matches.length > 1, identity, matches, reviews };
  }
}
