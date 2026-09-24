import type { PrismaService } from '../../common/prisma/prisma.service';

type Http = (path: string, method?: string, body?: unknown) => Promise<any>;
type Options = {
  connectionId: string; clientId: string; requestNumber: number; actorId: string;
  supplyHints?: string[]; allowedWarehouseIds?: string[]; http: Http; apply: boolean; wait?: (ms: number) => Promise<void>;
};
type Checkpoint = { stage: string; supplyId?: string; orderIds: string[]; name?: string; at: string };
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const cancelled = (status: string) => /cancel|declin|reject/i.test(status);

// FIX: retry only rolled-back database work. A timeout from WB must never replay supply creation.
async function retryDatabase<T>(action: () => Promise<T>, wait: (ms: number) => Promise<void>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if ((error as { code?: string }).code !== 'P2034' || attempt >= 2) throw error;
      await wait(100 * (attempt + 1));
    }
  }
}

// FIX: recovery is scoped to an already committed request. It never writes stock, KIZ,
// request items, request status or reservation fields and never creates another WMS request.
export async function recoverAutoAssemblyRequest(prisma: PrismaService, options: Options) {
  const { connectionId, clientId, actorId, http, apply } = options;
  const wait = options.wait ?? pause;
  const request = await prisma.clientRequest.findUniqueOrThrow({ where: { number: options.requestNumber } });
  if (request.clientId !== clientId) throw new Error('Заявка другого клиента.');
  if (request.status === 'CANCELLED') throw new Error('Заявка отменена.');
  const links = await prisma.fbsOrderRequestLink.findMany({ where: { requestId: request.id, clientId, connectionId, marketplace: 'WILDBERRIES', syncStatus: 'ACTIVE' } });
  if (!links.length) throw new Error('Нет активных связей заказов выбранного кабинета.');
  const ids = links.map(link => link.orderId).sort();
  if (ids.some(id => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('Некорректный номер WB.');
  const key = `fbs.autoAssembly.recovery.${connectionId}.${request.id}`;

  const work = async () => {
    // Re-read ownership while the same advisory locks used by manual assembly are held.
    const currentRequest = await prisma.clientRequest.findUniqueOrThrow({ where: { number: options.requestNumber } });
    if (currentRequest.clientId !== clientId || currentRequest.id !== request.id) throw new Error('Изменился клиент заявки.');
    if (['CANCELLED', 'DONE'].includes(currentRequest.status)) throw new Error('Заявка отменена или завершена.');
    const fresh = await prisma.fbsOrderRequestLink.findMany({ where: { requestId: request.id, clientId, connectionId, marketplace: 'WILDBERRIES', syncStatus: 'ACTIVE' } });
    if (fresh.map(link => link.orderId).sort().join(',') !== ids.join(',')) throw new Error('Состав заявки изменился. Повторите проверку.');
    const tasks = await prisma.fbsTsdAssembly.findMany({ where: { requestId: request.id, clientId, connectionId, marketplace: 'WILDBERRIES', orderId: { in: ids } } });
    const saved = await prisma.systemSetting.findUnique({ where: { key } });
    let checkpoint = saved?.value as unknown as Checkpoint | undefined;
    const write = async (value: Omit<Checkpoint, 'at'>) => {
      const next = { ...value, at: new Date().toISOString() };
      await retryDatabase(() => prisma.systemSetting.upsert({ where: { key }, create: { key, value: next, updatedByUserId: actorId }, update: { value: next, updatedByUserId: actorId } }), wait);
      checkpoint = next;
    };
    const statuses = new Map<string, { supplierStatus: string; wbStatus: string }>();
    for (let start = 0; start < ids.length; start += 1000) {
      const result = await http('/api/v3/orders/status', 'POST', { orders: ids.slice(start, start + 1000).map(Number) });
      if (!Array.isArray(result.orders)) throw new Error('WB не вернул статусы заказов.');
      for (const row of result.orders) if (row.supplierStatus && row.wbStatus) statuses.set(String(row.id), row);
    }
    if (ids.some(id => !statuses.has(id))) throw new Error('WB не подтвердил все статусы.');
    const liveIds = ids.filter(id => !cancelled(statuses.get(id)!.wbStatus) && !cancelled(statuses.get(id)!.supplierStatus));
    const newIds = liveIds.filter(id => statuses.get(id)!.supplierStatus === 'new');
    const hints = [...new Set([checkpoint?.supplyId, ...fresh.map(link => link.lastSupplyId), ...tasks.map(task => task.supplyId), ...(options.supplyHints ?? [])].filter((id): id is string => Boolean(id)))];
    if (hints.length > 1) throw new Error('Несколько поставок: требуется отдельная сверка состава.');
    let supplyId = hints[0];
    if (!liveIds.length) return { requestNumber: request.number, count: 0, stage: 'NO_ACTIVE_ORDERS' };
    if (newIds.length && tasks.some(task => newIds.includes(task.orderId) && (task.startedAt || task.boxId || task.barcode || task.kiz || task.completedAt || !['RESERVED', 'WAITING_STOCK'].includes(task.status)))) {
      throw new Error('Физический отбор уже начат; требуется решение менеджера.');
    }
    if (newIds.some(id => !tasks.some(task => task.orderId === id))) throw new Error('Для нового заказа нет задачи и резерва WMS.');
    const billing = await prisma.clientFbsBillingSettings.findUnique({ where: { clientId }, select: { defaultDeliveryDestination: true } });
    const destination = billing?.defaultDeliveryDestination ?? 'PICKUP_POINT';
    // Cargo recovery is a separate operation; do not silently pretend it was performed.
    if (destination === 'PICKUP_POINT') throw new Error('Для этого направления требуется отдельная проверка грузомест.');
    // Routing metadata exists on the deployed schema; older installations fail closed.
    const routedLinks = fresh as Array<typeof fresh[number] & { sellerWarehouseId?: string | null; sellerWarehouseName?: string | null }>;
    const warehouses = [...new Set(routedLinks.map(link => link.sellerWarehouseId).filter((id): id is string => Boolean(id)))];
    if (warehouses.length !== 1) throw new Error('Не определён единый склад WB заявки.');
    if (options.allowedWarehouseIds && !options.allowedWarehouseIds.includes(warehouses[0])) throw new Error('Склад больше не выбран в расписании автосборки.');
    const readComposition = async (id: string): Promise<string[]> => {
      const result = await http(`/api/marketplace/v3/supplies/${encodeURIComponent(id)}/order-ids`);
      if (!Array.isArray(result.orderIds)) throw new Error('WB вернул неизвестный формат состава.');
      const members = [...new Set<string>(result.orderIds.map(String))];
      if (members.some(member => !ids.includes(member))) throw new Error('В поставке посторонние заказы; автоматическое изменение запрещено.');
      return members;
    };
    let members = supplyId ? await readComposition(supplyId) : [];
    let meta = supplyId ? await http(`/api/v3/supplies/${encodeURIComponent(supplyId)}`) : null;
    if (meta && meta.id !== supplyId) throw new Error('WB вернул другую поставку.');
    if (!apply) return { requestNumber: request.number, count: liveIds.length, stage: 'PREVIEW', supplyId: supplyId ?? null, newOrders: newIds.length, confirmedMembers: members.length };
    if (!supplyId) {
      if (checkpoint?.stage === 'CREATE_PENDING') throw new Error('Результат создания поставки неизвестен. Сверьте WB; повторное создание заблокировано.');
      if (newIds.length !== liveIds.length) throw new Error('Заказы уже обрабатываются WB, но номер поставки неизвестен.');
      if (newIds.length > 100) throw new Error('Для восстановления более 100 новых заказов требуется разбиение операции.');
      const raw = await http('/api/v3/orders/new');
      const selected = (raw.orders ?? []).filter((row: any) => newIds.includes(String(row.id)));
      if (new Set(selected.map((row: any) => String(row.id))).size !== newIds.length || selected.some((row: any) => String(row.warehouseId) !== warehouses[0] || row.supplyId)) throw new Error('Новые заказы или склад WB изменились.');
      if (new Set(selected.map((row: any) => `${row.cargoType}:${row.crossBorderType}:${Boolean(row.isB2b)}`)).size !== 1) throw new Error('Заказам нужны разные типы поставок.');
      const name = `LOGOFF AUTO WMS ${request.number} ${request.id}`;
      // The durable intent precedes POST. On an ambiguous response it is deliberately not retried.
      await write({ stage: 'CREATE_PENDING', orderIds: liveIds, name });
      const created = await http('/api/v3/supplies', 'POST', { name });
      if (typeof created.id !== 'string' || !/^WB-GI-\d+$/.test(created.id)) throw new Error('WB не вернул номер поставки.');
      supplyId = created.id;
      await write({ stage: 'SUPPLY_CREATED', supplyId, orderIds: liveIds, name });
      meta = await http(`/api/v3/supplies/${encodeURIComponent(supplyId)}`);
    }
    const target = supplyId!;
    const missing = liveIds.filter(id => !members.includes(id));
    if (missing.length) {
      if (meta?.done || missing.some(id => statuses.get(id)!.supplierStatus !== 'new')) throw new Error('WB пока не подтвердил состав; повторный перенос подтверждённых заказов запрещён.');
      if (checkpoint && ['ASSIGN_PENDING', 'VERIFY_PENDING'].includes(checkpoint.stage)) throw new Error('Результат добавления заказов неизвестен; требуется повторная сверка состава WB.');
      await write({ stage: 'ASSIGN_PENDING', supplyId: target, orderIds: liveIds });
      // Recovery operates on one bounded group. More than 100 needs an explicit per-chunk checkpoint.
      if (missing.length > 100) throw new Error('Для восстановления более 100 новых заказов требуется разбиение операции.');
      await http(`/api/marketplace/v3/supplies/${encodeURIComponent(target)}/orders`, 'PATCH', { orders: missing.map(Number) });
      await write({ stage: 'VERIFY_PENDING', supplyId: target, orderIds: liveIds });
      for (let attempt = 0; attempt < 5; attempt++) {
        members = await readComposition(target);
        if (liveIds.every(id => members.includes(id))) break;
        if (attempt < 4) await wait(1000 * (attempt + 1));
      }
    }
    if (liveIds.some(id => !members.includes(id))) throw new Error('WB пока не подтвердил полный состав поставки.');
    const existing = await prisma.fbsSupplyPlan.findUnique({ where: { marketplace_connectionId_supplyId: { marketplace: 'WILDBERRIES', connectionId, supplyId: target } } });
    if (existing && existing.clientId !== clientId) throw new Error('План поставки другого клиента.');
    await retryDatabase(() => prisma.$transaction(async tx => {
      await tx.fbsSupplyPlan.upsert({ where: { marketplace_connectionId_supplyId: { marketplace: 'WILDBERRIES', connectionId, supplyId: target } },
        create: { clientId, connectionId, marketplace: 'WILDBERRIES', supplyId: target, marketplaceWarehouseId: warehouses[0], marketplaceWarehouseName: routedLinks[0].sellerWarehouseName, deliveryDestination: destination, itemsPerCargoPlace: 2000000000, cargoPlaceCount: 0, cargoPlaceIds: [], orderIds: members, createdByUserId: actorId, ...(meta?.destinationOfficeId ? { destinationOfficeId: String(meta.destinationOfficeId) } : {}) },
        update: { orderIds: members } });
      await tx.fbsTsdAssembly.updateMany({ where: { requestId: request.id, clientId, connectionId, marketplace: 'WILDBERRIES', orderId: { in: members } }, data: { supplyId: target } });
      await tx.fbsOrderRequestLink.updateMany({ where: { requestId: request.id, clientId, connectionId, marketplace: 'WILDBERRIES', syncStatus: 'ACTIVE', orderId: { in: members } }, data: { lastSupplyId: target } });
      const value = { stage: 'VERIFIED', supplyId: target, orderIds: members, at: new Date().toISOString() };
      await tx.systemSetting.upsert({ where: { key }, create: { key, value, updatedByUserId: actorId }, update: { value, updatedByUserId: actorId } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'AUTO_ASSEMBLY_RECOVERED', entity: 'ClientRequest', entityId: request.id, payload: { connectionId, requestNumber: request.number, supplyId: target, orderIds: members } } });
    }), wait);
    return { requestNumber: request.number, count: liveIds.length, stage: 'VERIFIED', supplyId: target };
  };
  if (!apply) return work();
  // Do not retry this outer transaction: its callback includes external operations.
  return prisma.$transaction(async tx => {
    for (const id of ids) {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${'fbs-assembly:' + clientId + ':' + connectionId + ':' + id})) AS locked`;
      if (!rows[0]?.locked) throw new Error('Заказы уже обрабатываются другим процессом.');
    }
    return work();
  }, { timeout: 600000, maxWait: 5000 });
}

// FIX: only failed automatic requests are eligible. Manual requests are never adopted.
export async function recoverFailedAutoAssemblies(prisma: PrismaService, connectionId: string, actorId: string, config?: { allWarehouses: boolean; warehouseIds: string[] }) {
  if (process.env.WMS_AUTO_ASSEMBLY_ENABLED !== 'true' || process.env.WMS_AUTO_ASSEMBLY_RECOVERY_ENABLED !== 'true') return [];
  const connection = await prisma.clientMarketplaceConnection.findUniqueOrThrow({ where: { id: connectionId } });
  if (!connection.isActive || connection.marketplace !== 'WILDBERRIES') return [];
  const runs = await prisma.systemSetting.findMany({ where: { key: { startsWith: `fbs.autoAssembly.run.${connectionId}.` } } });
  const candidates = new Map<number, Set<string>>();
  for (const row of runs) {
    const value = row.value as unknown as { groups?: Array<{ requestNumber?: number; error?: string }> };
    for (const group of value.groups ?? []) if (group.requestNumber && group.error) {
      const hints = candidates.get(group.requestNumber) ?? new Set<string>();
      for (const id of group.error.match(/WB-GI-\d+/g) ?? []) hints.add(id);
      candidates.set(group.requestNumber, hints);
    }
  }
  const results: Array<{ label: string; count: number; requestNumber: number; error?: string; stage?: string }> = [];
  for (const [requestNumber, hints] of candidates) {
    const request = await prisma.clientRequest.findUnique({ where: { number: requestNumber }, select: { id: true, status: true, clientId: true } });
    if (!request || request.clientId !== connection.clientId || ['DONE', 'CANCELLED'].includes(request.status)) continue;
    const checkpoint = await prisma.systemSetting.findUnique({ where: { key: `fbs.autoAssembly.recovery.${connectionId}.${request.id}` } });
    if ((checkpoint?.value as unknown as Checkpoint)?.stage === 'VERIFIED') continue;
    try {
      const result = await recoverAutoAssemblyRequest(prisma, { connectionId, clientId: connection.clientId, requestNumber, actorId, supplyHints: [...hints], allowedWarehouseIds: config && !config.allWarehouses ? config.warehouseIds : undefined, http: wbRecoveryHttp(connection.apiKey), apply: true });
      results.push({ label: `Восстановление №${requestNumber}`, ...result });
    } catch (error) { results.push({ label: `Восстановление №${requestNumber}`, requestNumber, count: 0, error: error instanceof Error ? error.message : 'Ошибка восстановления' }); }
  }
  return results;
}

export function wbRecoveryHttp(apiKey: string): Http {
  return async (path, method = 'GET', body) => {
    const response = await fetch('https://marketplace-api.wildberries.ru' + path, { method, headers: { Authorization: apiKey, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`WB ${method} ${path}: HTTP ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  };
}
