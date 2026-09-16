import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { assertWarehouseAccess, warehouseScopeWhere } from '../client-requests/client-request-warehouse-scope';

export const SEARCH_CREATED = 'KIZ_SEARCH_CREATED';
export const SEARCH_FOUND = 'KIZ_SEARCH_FOUND';
export type SearchTarget = { itemId: string; boxCode: string; kiz: string; order: string; firstWorker: string };

// FIX: compare the physical identity, preserving case and punctuation in the serial.
export function scanMatchesTarget(raw: string, identity: string): boolean {
  if (!/^01\d{14}21[^\x1d\r\n]{13}$/.test(identity)) return false;
  const scan = raw.trim().replace(/^\]d2/i, '').replace(/<GS>/gi, '\x1d')
    .replace(/^\(01\)(\d{14})\(21\)/, (_, gtin: string) => `01${gtin}21`);
  if (!scan.startsWith(identity)) return false;
  const tail = scan.slice(identity.length);
  return tail === '' || /^\x1d91[^\x1d]{4}\x1d92[^\r\n]+$/.test(tail) || /^91.{4}92[^\r\n]+$/.test(tail);
}

@Injectable()
export class KizSearchService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly scope: ClientScopeService) {}

  private enabled() {
    if (this.config.get<string>('WMS_TSD_KIZ_SEARCH') !== 'true') throw new NotFoundException();
  }

  async list(user: AuthUser) {
    this.enabled();
    const markers = await this.prisma.auditLog.findMany({ where: { action: SEARCH_CREATED, entity: 'ClientRequest' }, select: { entityId: true } });
    const requests = await this.prisma.clientRequest.findMany({
      where: { id: { in: markers.map(m => m.entityId).filter((id): id is string => !!id) },
        type: 'OTHER', status: { in: ['SUBMITTED', 'IN_WORK'] }, assignedToUserId: user.id,
        clientId: this.scope.resolveClientFilter(user), ...warehouseScopeWhere(user) },
      orderBy: { number: 'asc' },
    });
    return Promise.all(requests.map(r => this.get(r.id, user)));
  }

  private async load(db: Prisma.TransactionClient, id: string, user: AuthUser, write = false) {
    const request = await db.clientRequest.findFirst({ where: { id, type: 'OTHER', assignedToUserId: user.id }, include: { items: true } });
    if (!request) throw new NotFoundException('Заявка поиска не найдена или назначена другому сотруднику.');
    this.scope.requireClientAccess(user, request.clientId, write ? 'write' : 'read');
    assertWarehouseAccess(user, request, write ? 'write' : 'read');
    const marker = await db.auditLog.findFirst({ where: { entity: 'ClientRequest', entityId: id, action: SEARCH_CREATED } });
    const data = marker?.payload as { targets?: SearchTarget[] } | null;
    const targets = data?.targets;
    if (!Array.isArray(targets) || targets.length === 0 || targets.length !== request.items.length ||
        new Set(targets.map(t => t.itemId)).size !== targets.length || new Set(targets.map(t => t.kiz)).size !== targets.length ||
        targets.some(t => !request.items.some(i => i.id === t.itemId && i.quantity === 1) || !t.boxCode || !scanMatchesTarget(t.kiz, t.kiz))) {
      throw new BadRequestException('Некорректный список поиска. Обратитесь к менеджеру.');
    }
    const found = await db.auditLog.findMany({ where: { action: SEARCH_FOUND, entity: 'ClientRequestItem', entityId: { in: targets.map(t => t.itemId) } }, select: { entityId: true } });
    return { request, targets, found: new Set(found.map(f => f.entityId)) };
  }

  async get(id: string, user: AuthUser) {
    this.enabled();
    const { request, targets, found } = await this.load(this.prisma, id, user);
    const boxes = await this.prisma.box.findMany({ where: { code: { in: targets.map(t => t.boxCode) }, clientId: request.clientId, warehouseId: request.warehouseId },
      select: { code: true, pallet: { select: { code: true } }, storagePlacement: { select: { pallet: { select: { code: true } } } } } });
    return { id, number: request.number, title: request.title, status: request.status, total: targets.length, found: found.size,
      items: targets.map(t => {
        const item = request.items.find(i => i.id === t.itemId)!;
        const box = boxes.find(b => b.code === t.boxCode);
        return { ...t, name: item.name, barcode: item.barcode, found: found.has(t.itemId),
          pallet: box?.storagePlacement?.pallet.code ?? box?.pallet?.code ?? null };
      }) };
  }

  async scan(id: string, dto: { boxCode: string; kiz: string }, user: AuthUser) {
    this.enabled();
    const boxCode = dto.boxCode.trim();
    // FIX: lock the request so retries/concurrent scanners cannot double-confirm or finish early.
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM "ClientRequest" WHERE id = ${id} FOR UPDATE`;
      const { request, targets, found } = await this.load(db, id, user, true);
      if (!['SUBMITTED', 'IN_WORK', 'DONE'].includes(request.status)) throw new BadRequestException('Поиск по этой заявке закрыт.');
      if (!targets.some(t => t.boxCode === boxCode)) throw new BadRequestException('Этот короб не входит в заявку поиска.');
      const target = targets.find(t => scanMatchesTarget(dto.kiz, t.kiz));
      if (!target) return { result: 'NOT_TARGET', message: 'Этот товар не входит в список поиска. Сканируйте следующий КИЗ.', found: found.size, total: targets.length };
      if (target.boxCode !== boxCode) throw new BadRequestException('Нужный КИЗ найден в другом коробе. Сообщите менеджеру; находка пока не подтверждена.');
      if (found.has(target.itemId)) return { result: 'ALREADY_FOUND', message: 'Этот товар уже найден. Отложите его отдельно.', itemId: target.itemId, found: found.size, total: targets.length };
      if (request.status === 'DONE') throw new BadRequestException('Заявка завершена. Обратитесь к менеджеру.');
      const count = found.size + 1;
      await db.auditLog.create({ data: { userId: user.id, action: SEARCH_FOUND, entity: 'ClientRequestItem', entityId: target.itemId,
        payload: { requestId: id, boxCode, kiz: target.kiz, order: target.order } } });
      const status = count === targets.length ? 'DONE' : 'IN_WORK';
      await db.clientRequest.update({ where: { id }, data: { status } });
      await db.clientRequestEvent.create({ data: { requestId: id, clientId: request.clientId, eventType: 'COMMENT',
        title: `Найден товар: ${count} из ${targets.length}`, body: `Короб ${boxCode}, заказ WB ${target.order}. КИЗ подтверждён сканированием.`, createdByUserId: user.id } });
      return { result: 'FOUND', message: 'Найден нужный товар. Отложите его отдельно.', itemId: target.itemId, found: count, total: targets.length };
    });
  }
}
