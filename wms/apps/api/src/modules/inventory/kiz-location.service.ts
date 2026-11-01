import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { storageBoxTransferKizIdentity } from '../stock/stock-operations.service';

@Injectable()
export class KizLocationService {
  constructor(private readonly prisma: PrismaService, private readonly clients: ClientScopeService) {}
  // FIX: delegate to the existing published queue; retain its authorization and audit.
  async reviews(user: AuthUser, cursor?: string, status?:string) {
    if (status === 'CLOSED') {
      if (!require('../../common/kiz-review-queue').kizReviewEnabled() || user.isDemo ||
          !user.roleCodes.some(role=>['ADMIN','OWNER','SUPER_ADMIN'].includes(role)) ||
          !user.activeWarehouseId || (!user.permissionCodes.includes('system:admin') && !user.warehouseIds?.includes(user.activeWarehouseId))) {
        throw new ForbiddenException('Нет доступа к истории обращений филиала.');
      }
      const rows=await (this.prisma as any).kizReviewCase.findMany({where:{warehouseId:user.activeWarehouseId,
        clientId:this.clients.resolveClientFilter(user),status:'CLOSED',resolution:'CLOSE'},
        orderBy:[{decidedAt:'desc'},{id:'desc'}],take:51,...(cursor?{cursor:{id:cursor},skip:1}:{})});
      const items=rows.slice(0,50).map((row:any)=>({id:row.id,taskId:row.taskId,kizIdentity:row.kizIdentity,
        status:row.status,resolution:row.resolution,reason:row.reason,attempts:row.attempts,createdAt:row.createdAt,
        updatedAt:row.updatedAt,decidedAt:row.decidedAt,decidedByName:row.decidedByName,
        ...require('../../common/kiz-client-review').clientReviewPresentation(row,user.activeWarehouseId)}));
      return {items,nextCursor:rows.length>50?items[49].id:null};
    }
    return new (require('../../common/kiz-review-queue').KizReviewQueue)(this.prisma, this.clients).list(user, cursor); }
  async decideReview(id: string, resolution: string, reason: string, confirmed: boolean, user: AuthUser) {
    if (resolution === 'CLOSE') {
      if (!require('../../common/kiz-review-queue').kizReviewEnabled() || user.isDemo || !user.roleCodes.some(role=>['ADMIN','OWNER','SUPER_ADMIN'].includes(role))) throw new ForbiddenException('Закрытие обращения доступно администратору.');

      const row = await (this.prisma as any).kizReviewCase.findUnique({where:{id}});
      if (!row || row.snapshot?.scope !== 'RECEIPT') throw new BadRequestException('Не найдено обращение приёмки.');
      return require('../../common/kiz-client-review').decideClientKizReview(this.prisma,this.clients,row,resolution,reason,confirmed,user);
    }
    return new (require('../../common/kiz-review-queue').KizReviewQueue)(this.prisma, this.clients).decide(id, resolution, reason, confirmed, user);
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
    const matches = marks.map(mark => {
      const box = mark.box;
      const placement = box ? placements.find(p => p.pallet.clientId === mark.clientId && p.pallet.warehouseId === warehouseId &&
        (p.boxId === box.id || (!p.boxId && p.boxCode === box.code))) : null;
      const boxIsConsistent = box?.clientId === mark.clientId && box.warehouseId === warehouseId;
      const legacy = boxIsConsistent && !placement && box?.pallet?.clientId === mark.clientId ? box.pallet : null;
      const room = placement?.pallet.zone ?? legacy?.zone ?? (boxIsConsistent ? box?.zone : null);
      return {
        id: mark.id, product: mark.sku, client: mark.client.name, status: mark.status,
        boxCode: boxIsConsistent ? box!.code : null, boxStatus: boxIsConsistent ? box!.status : null,
        palletCode: boxIsConsistent ? placement?.pallet.code ?? legacy?.code ?? null : null,
        room: boxIsConsistent && room?.warehouseId === warehouseId ? room.name : null,
        warehouse: boxIsConsistent ? box?.warehouse?.name ?? null : !box ? mark.stockMovement?.warehouse?.name ?? null : null,
        locationWarning: box && !boxIsConsistent ? 'Принадлежность короба не совпадает с КИЗ. Нужна проверка.' : null,
      };
    });
    // FIX: lookup remains read-only; explicit physical confirmation opens the case.
    const foundCandidate = process.env.WMS_KIZ_FOUND_REVIEW_ENABLED === 'true' && matches.length === 1 &&
      matches[0].status === 'SHIPPING' && !matches[0].boxCode ? {markId: matches[0].id, identity} : undefined;
    return { found: matches.length > 0, ambiguous: matches.length > 1, identity, matches, foundCandidate };
  }
}
