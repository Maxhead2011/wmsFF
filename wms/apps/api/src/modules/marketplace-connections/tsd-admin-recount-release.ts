import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, type FbsTsdAssembly, type FbsOrderRequestLink } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { storageBoxTransferKizIdentity } from '../stock/stock-operations.service';
import { parseRecountScans, recountHash } from '../stock/tsd-transfer-kiz-recount';

type RecountInput = { source: { id: string; code: string; clientId: string; warehouseId: string | null; palletId: string | null; status: string };
  skuId: string; scans: ReturnType<typeof parseRecountScans> };

// ADDED: one physical SKU, with full identities and same-warehouse active request links.
export async function loadAdminRecountContext(tx: Prisma.TransactionClient, input: RecountInput) {
  const { source, skuId, scans } = input;
  if (!source.warehouseId || !['active', 'receiving', 'archived'].includes(source.status)) throw new BadRequestException('Для административной сверки нужен существующий короб в выбранном филиале.');
  const variants = (gtin: string, serial: string) => [`01${gtin}21${serial}`, `]d201${gtin}21${serial}`, `(01)${gtin}(21)${serial}`,
    `01${gtin}\u001d21${serial}`, `]d201${gtin}\u001d21${serial}`, `01${gtin}<GS>21${serial}`];
  const previous = await tx.productMark.findMany({ where: { boxId: source.id, skuId }, orderBy: { id: 'asc' }, take: 201 });
  if (previous.length > 200) throw new BadRequestException('В коробе более 200 привязок. Сначала проверьте состав.');
  const prefixes = [...scans.flatMap(scan => variants(scan.gtin, scan.serial)), ...previous.flatMap(mark => {
    const identity = storageBoxTransferKizIdentity(mark.value);
    if (!identity) throw new BadRequestException('В коробе есть неполный старый КИЗ. Требуется исправить его формат.');
    return variants(identity.gtin, identity.serial);
  })];
  const kizWhere = { OR: prefixes.map(prefix => ({ kiz: { startsWith: prefix } })) };
  const marks = await tx.productMark.findMany({ where: { OR: prefixes.map(prefix => ({ value: { startsWith: prefix } })) }, orderBy: { id: 'asc' }, take: 401 });
  if (marks.length > 400) throw new BadRequestException('Слишком много совпадений КИЗ.');
  const physicalValues = marks.filter(mark => {
    const id = storageBoxTransferKizIdentity(mark.value);
    return id && scans.some(scan => scan.gtin === id.gtin && scan.serial === id.serial);
  }).map(mark => mark.value);
  const tasks = await tx.fbsTsdAssembly.findMany({ where: { OR: [kizWhere, { clientId: source.clientId,
    AND: [{ OR: [{ skuId }, { sourceSkuId: skuId }] }, { OR: [{ boxId: source.id }, { reservedBoxId: source.id }] }],
    status: { in: ['IN_PROGRESS', 'RESCAN_REQUIRED', 'RESERVED', 'WAITING_STOCK', 'RETURN_REQUIRED', 'ADMIN_RECOUNT_PENDING'] } }] }, orderBy: { id: 'asc' }, take: 21 });
  if (!tasks.length || tasks.length > 20) throw new BadRequestException('Нет безопасно освобождаемой сборки или связано более 20 заказов. Остатки не изменены.');
  const requests = [], links = [];
  for (const task of tasks) {
    const request = await tx.clientRequest.findUnique({ where: { id: task.requestId } });
    const link = await tx.fbsOrderRequestLink.findUnique({ where: { marketplace_connectionId_orderId: {
      marketplace: task.marketplace, connectionId: task.connectionId, orderId: task.orderId } } });
    validateRecountTask(task, source, skuId, physicalValues, request, link);
    requests.push(request!); links.push(link!);
  }
  const ids = tasks.map(task => task.id);
  const histories = await Promise.all([
    tx.shippedKizHistory.findFirst({ where: kizWhere }),
    tx.fbsAssemblyAttemptHistory.findFirst({ where: kizWhere }),
    tx.kizCirculationItem.findFirst({ where: { OR: prefixes.map(prefix => ({ kizRaw: { startsWith: prefix } })) } }),
    tx.fbsWebKizStickerPrint.findFirst({ where: { ...kizWhere, assemblyId: { notIn: ids } } }),
    tx.fbsPrintJob.findFirst({ where: { ...kizWhere, assemblyId: { notIn: ids } } }),
  ]);
  if (histories.some(Boolean)) throw new BadRequestException('Есть история отгрузки, оборота или другой сборки. Автоматический возврат запрещён; необходима отдельная повторная приёмка.');
  const identities = new Set<string>();
  for (const mark of marks) {
    const identity = storageBoxTransferKizIdentity(mark.value);
    const key = identity && `01${identity.gtin}21${identity.serial}`;
    const owned = tasks.some(task => task.kiz === mark.value && physicalValues.includes(mark.value));
    if (!key || identities.has(key) || mark.clientId !== source.clientId || mark.skuId !== skuId ||
        mark.boxId !== source.id && !(mark.boxId === null && owned && mark.status === 'PACKING') ||
        mark.status !== 'AVAILABLE' && !(owned && mark.status === 'PACKING')) throw new BadRequestException('КИЗ принадлежит другому товару, месту хранения или имеет неподтверждённый статус.');
    identities.add(key);
  }
  const balances = await tx.stockBalance.findMany({ where: { boxId: source.id, skuId }, orderBy: { id: 'asc' } });
  return { source: { id: source.id, code: source.code, clientId: source.clientId, warehouseId: source.warehouseId, palletId: source.palletId, status: source.status },
    skuId, tasks, marks, balances, links, requestIds: [...new Set(tasks.map(task => task.requestId))],
    snapshot: recountHash({ source: { id: source.id, warehouseId: source.warehouseId, palletId: source.palletId, status: source.status },
      skuId, tasks, marks, balances, links, requests, scans: scans.map(scan => scan.key) }) };
}

export type AdminRecountContext = Awaited<ReturnType<typeof loadAdminRecountContext>>;

// FIX: possession permits an explicit admin decision, not bypassing client/warehouse/shipment boundaries.
export function requireAdminRecount(user: AuthUser, enabled: boolean) {
  if (!enabled || user.isDemo || user.roleCodes.includes('CLIENT') ||
      !(user.roleCodes.some(role => ['ADMIN', 'OWNER'].includes(role)) || user.permissionCodes.includes('system:admin'))) {
    throw new ForbiddenException('Подтверждение физического остатка доступно только администратору WMS.');
  }
}

export function validateRecountTask(task: FbsTsdAssembly,
  source: { id: string; clientId: string; warehouseId: string | null }, skuId: string, scannedKizs: string[],
  request: { clientId: string; warehouseId: string | null; status: string } | null,
  link: FbsOrderRequestLink | null) {
  if (task.clientId !== source.clientId || task.skuId !== skuId || task.sourceSkuId && task.sourceSkuId !== skuId ||
      task.marketplace !== 'WILDBERRIES' || task.itemCount !== 1 || task.completedAt || task.cargoPackingId || task.cargoPackedAt ||
      !['IN_PROGRESS', 'RESCAN_REQUIRED', 'RESERVED', 'WAITING_STOCK'].includes(task.status) ||
      task.boxId && task.boxId !== source.id || task.kiz && !scannedKizs.includes(task.kiz)) {
    throw new BadRequestException(`Заказ ${task.orderId ?? task.id}: нельзя снять чужой товар или завершённую отгрузку. Для отгруженного товара нужна повторная приёмка.`);
  }
  if (!request || request.clientId !== source.clientId || request.warehouseId !== source.warehouseId ||
      ['DONE', 'CANCELLED', 'REJECTED'].includes(request.status) || !link || link.requestId !== task.requestId ||
      link.syncStatus !== 'ACTIVE' || link.lastCategory !== 'active' || link.lastSupplierStatus !== 'confirm') {
    throw new BadRequestException(`Заказ ${task.orderId ?? task.id}: заявка или статус WB изменились. Незавершённая сборка не подтверждена.`);
  }
}

// FIX: the original requests survive; rebuild only their remaining routes, and never swallow a failure.
export async function rebuildRecountRequests(ids: string[], repair: (id: string) => Promise<unknown>) {
  for (const id of [...new Set(ids)]) await repair(id);
}

// ADDED: durable, retriable WB/local boundary. Held tasks cannot be handed to another picker.
export async function runAdminRecount<T extends { tasks: FbsTsdAssembly[]; requestIds: string[]; snapshot: string }>(options: {
  db: PrismaService; user: AuthUser; id: string; fingerprint: string; snapshot: unknown;
  load: (tx: Prisma.TransactionClient) => Promise<T>;
  releaseWb: (context: T) => Promise<void>;
  apply: (tx: Prisma.TransactionClient, context: T) => Promise<unknown>;
  repair: (id: string) => Promise<unknown>;
  abort?: boolean;
}) {
  const { db, id, fingerprint } = options;
  type Saved = { fingerprint: string; phase: 'PREPARED' | 'APPLIED' | 'DONE' | 'ABORTED'; context: T };
  const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  let saved = await db.$transaction(async tx => {
    const existing = await tx.auditLog.findUnique({ where: { id } });
    if (existing) {
      const state = existing.payload as unknown as Saved;
      if (state.fingerprint !== fingerprint) throw new BadRequestException('Номер подтверждения уже использован с другими данными.');
      return state;
    }
    if (options.abort) {
      // FIX: a tombstone also cancels a confirmation which has not yet reached the server.
      const cancelled: Saved = { fingerprint, phase: 'ABORTED', context: null as unknown as T };
      await tx.auditLog.create({ data: { id, userId: options.user.id, action: 'TSD_ADMIN_RECOUNT_RELEASE', entity: 'TsdRecount', entityId: id, payload: json(cancelled) } });
      return cancelled;
    }
    const context = await options.load(tx);
    if (context.snapshot !== options.snapshot) throw new BadRequestException('Состояние изменилось. Повторите предварительную проверку.');
    for (const task of context.tasks) {
      const claimed = await tx.fbsTsdAssembly.updateMany({ where: { id: task.id, status: task.status, updatedAt: task.updatedAt },
        data: { status: 'ADMIN_RECOUNT_PENDING', errorMessage: `Администратор выполняет физическую сверку. Операция ${id}.` } });
      if (claimed.count !== 1) throw new BadRequestException('Сборка изменилась. Подтверждение не выполнено.');
    }
    const state: Saved = { fingerprint, phase: 'PREPARED', context };
    await tx.auditLog.create({ data: { id, userId: options.user.id, action: 'TSD_ADMIN_RECOUNT_RELEASE',
      entity: 'TsdRecount', entityId: id, payload: json(state) } });
    return JSON.parse(JSON.stringify(state)) as Saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (saved.phase === 'PREPARED') {
    saved = await db.$transaction(async tx => {
      // FIX: serialize concurrent confirmations before contacting WB. A stale waiter aborts before DELETE.
      await tx.auditLog.update({ where: { id }, data: { entityId: id } });
      const fresh = await tx.auditLog.findUnique({ where: { id } });
      const current = fresh!.payload as unknown as Saved;
      if (current.phase !== 'PREPARED') return current;
      if (options.abort) {
        for (const task of current.context.tasks) await tx.fbsTsdAssembly.updateMany({
          where: { id: task.id, status: 'ADMIN_RECOUNT_PENDING', kiz: task.kiz },
          data: { status: 'RESCAN_REQUIRED', wbMetaStatus: 'PENDING', stickerPartA: null, stickerPartB: null, stickerBarcode: null,
            errorMessage: 'Администратор отменил незавершённую сверку. Остатки не менялись. Повторно проверьте ШК, КИЗ и метаданные WB; старый стикер не использовать.' } });
        const aborted: Saved = { ...current, phase: 'ABORTED' };
        await tx.auditLog.update({ where: { id }, data: { payload: json(aborted) } });
        return aborted;
      }
      await options.releaseWb(current.context);
      const applied = await options.apply(tx, current.context) as { affectedRequestIds?: string[] } | undefined;
      const next: Saved = { ...current, phase: 'APPLIED', context: { ...current.context,
        requestIds: [...new Set([...current.context.requestIds, ...(applied?.affectedRequestIds ?? [])])] } };
      await tx.auditLog.update({ where: { id }, data: { payload: json(next) } });
      return next;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000 });
  }
  if (saved.phase === 'ABORTED') return { state: 'RECOUNT_CANCELLED', message: 'Незавершённая сверка отменена. Остатки не менялись. Заказы требуют повторной проверки КИЗ; начните новый физический пересчёт на ТСД.' };
  if (saved.phase === 'APPLIED') {
    await rebuildRecountRequests(saved.context.requestIds, options.repair);
    await db.auditLog.update({ where: { id }, data: { payload: json({ ...saved, phase: 'DONE' }) } });
  }
  return { state: 'RECOUNT_APPLIED', message: 'Решение администратора применено. КИЗы освобождены, остаток сверён, маршруты затронутых заявок обновлены. Повторите ШК и КИЗ для перемещения.' };
}
