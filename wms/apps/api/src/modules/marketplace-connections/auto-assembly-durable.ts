import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

// FIX: this journal owns only execution checkpoints, never stock or reservation state.
// Runtime-only auto-assembly modules call this adapter; Prisma schema is unchanged.
type Db = any;
type Http = (path: string, method?: string, body?: unknown) => Promise<any>;
type Context = { connectionId: string; runKey?: string; operation?: any };
const context = new AsyncLocalStorage<Context>();
const prefix = 'fbs.autoAssembly.operation.';
export const enabled = () => process.env.WMS_AUTO_ASSEMBLY_DURABLE_ENABLED === 'true';
const idsOf = (orders: any[]) => orders.map(o => String(o.orderId ?? o.id)).sort();
const same = (a: string[], b: string[]) => [...a].sort().join(',') === [...b].sort().join(',');
const message = (e: unknown) => e instanceof Error ? e.message : 'Ошибка сверки автосборки';
const save = (db: Db, key: string, value: any, actor: string) => db.systemSetting.upsert({
  where: { key }, create: { key, value, updatedByUserId: actor }, update: { value, updatedByUserId: actor },
});
async function progress(db: Db, op: any, value: any) {
  if (!op.runKey) return;
  const run = await db.systemSetting.findUnique({ where: { key: op.runKey } });
  if (!run || run.value.status !== 'RUNNING') return;
  const groups = (run.value.groups ?? []).filter((g: any) => g.requestNumber !== op.requestNumber);
  groups.push({ requestNumber: op.requestNumber, count: op.orderIds.length, label: `Заявка №${op.requestNumber}`, ...value });
  await db.systemSetting.update({ where: { key: op.runKey }, data: { value: { ...run.value, groups } } });
}

export async function withRun<T>(db: Db, connectionId: string, work: () => Promise<T>): Promise<T | undefined> {
  if (!enabled()) return work();
  // FIX: held across the run, released by PostgreSQL on process death. No TTL takeover.
  return db.$transaction(async (tx: Db) => {
    const rows = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${'fbs-auto-run:' + connectionId})) AS locked`;
    if (!rows[0]?.locked) return undefined;
    return context.run({ connectionId }, work);
  }, { timeout: 1800000, maxWait: 5000 });
}
export function setRunKey(key: string) { const ctx = context.getStore(); if (ctx) ctx.runKey = key; }

export async function requestCreated(tx: Db, request: any, clientId: string, orders: any[], actor: string) {
  const ctx = context.getStore();
  if (!enabled() || !ctx || orders.some(o => o.marketplace !== 'WILDBERRIES' || o.connectionId !== ctx.connectionId)) return;
  const operation: any = { requestId: request.id, requestNumber: request.number, clientId, connectionId: ctx.connectionId,
    actor, runKey: ctx.runKey, orderIds: idsOf(orders), groups: [], stage: 'REQUEST_CREATED', at: new Date().toISOString() };
  // Called INSIDE the transaction that inserts ClientRequest and its order links.
  for (const supplyId of new Set(orders.map(o => o.supplyId).filter(Boolean))) {
    const orderIds = idsOf(orders.filter(o => o.supplyId === supplyId));
    const key = `fbs.autoAssembly.recovery.${ctx.connectionId}.${request.id}.${createHash('sha256').update(orderIds.join(',')).digest('hex').slice(0,16)}`;
    operation.groups.push({ key, orderIds });
    await save(tx, key, { stage: 'SUPPLY_CREATED', supplyId, orderIds }, actor);
  }
  await save(tx, prefix + ctx.connectionId + '.' + request.id, operation, actor);
  await progress(tx, operation, { stage: 'REQUEST_CREATED' });
  ctx.operation = operation;
}

export async function beginSupply(db: Db, connectionId: string, orders: any[], originalName: string) {
  const ctx = context.getStore(), op = ctx?.operation;
  if (!enabled() || !op || ctx!.connectionId !== connectionId) return null;
  const orderIds = idsOf(orders);
  if (orderIds.some(id => !op.orderIds.includes(id))) throw Error('Состав автосборки изменился.');
  const suffix = createHash('sha256').update(orderIds.join(',')).digest('hex').slice(0, 16);
  const key = `fbs.autoAssembly.recovery.${connectionId}.${op.requestId}.${suffix}`;
  const name = `LOGOFF AUTO WMS ${op.requestNumber} ${op.requestId} ${suffix}`;
  if (op.groups.some((g: any) => g.key === key)) throw Error('Этап создания поставки уже начат; требуется сверка WB.');
  const group = { key, name, orderIds };
  op.groups.push(group);
  await db.$transaction(async (tx: Db) => {
    await save(tx, prefix + connectionId + '.' + op.requestId, op, op.actor);
    await save(tx, key, { stage: 'CREATE_PENDING', name, orderIds, at: new Date().toISOString() }, op.actor);
    await progress(tx, op, { stage: 'CREATE_PENDING' });
  });
  return { ...group, op, originalName };
}
export async function stage(db: Db, handle: any, value: any) {
  if (!handle) return;
  await save(db, handle.key, { name: handle.name, orderIds: handle.orderIds, ...value, at: new Date().toISOString() }, handle.op.actor);
  await progress(db, handle.op, value);
}
export async function completeSupply(db: Db, handle: any, supplyId: string) {
  if (!handle) return;
  await db.$transaction(async (tx: Db) => {
    const where = { requestId: handle.op.requestId, clientId: handle.op.clientId, connectionId: handle.op.connectionId,
      marketplace: 'WILDBERRIES', orderId: { in: handle.orderIds } };
    await tx.fbsOrderRequestLink.updateMany({ where: { ...where, syncStatus: 'ACTIVE' }, data: { lastSupplyId: supplyId } });
    await tx.fbsTsdAssembly.updateMany({ where, data: { supplyId } });
    await stage(tx, handle, { stage: 'VERIFIED', supplyId });
  });
}

export async function finishOperation(db: Db, http: Http) {
  const op = context.getStore()?.operation;
  if (!enabled() || !op) return;
  const covered: string[] = [];
  for (const group of op.groups) {
    const checkpoint = (await db.systemSetting.findUnique({ where: { key: group.key } }))?.value;
    if (!checkpoint?.supplyId) throw Error('Поставка WB ещё не подтверждена.');
    const result = await http(`/api/marketplace/v3/supplies/${encodeURIComponent(checkpoint.supplyId)}/order-ids`);
    if (!Array.isArray(result.orderIds) || !same(result.orderIds.map(String), group.orderIds)) throw Error('Состав поставки WB не совпадает с заявкой.');
    await completeSupply(db, { ...group, op }, checkpoint.supplyId);
    covered.push(...group.orderIds);
  }
  if (!same(covered, op.orderIds)) throw Error('Не все заказы подтверждены в поставках WB.');
  op.stage = 'VERIFIED';
  await save(db, prefix + op.connectionId + '.' + op.requestId, op, op.actor);
}

// FIX: recover a lost POST response by its unique persisted intent; never repeat POST.
// Also locate a manually assigned supply by exact order membership when no local ID exists.
export async function discoverSupply(http: Http, ids: string[], name?: string): Promise<string | undefined> {
  const found = new Set<string>(); let next = 0, inspected = 0;
  for (let page = 0; page < 10; page++) {
    const response = await http(`/api/v3/supplies?limit=1000&next=${next}`);
    if (!Array.isArray(response.supplies) || !Number.isInteger(response.next)) throw Error('WB не подтвердил список поставок.');
    for (const supply of response.supplies) {
      if (!supply?.id || supply.done) continue;
      if (name) { if (supply.name === name) found.add(supply.id); }
      else {
        if (++inspected > 100) throw Error('Слишком много открытых поставок для сверки; требуется разбор.');
        const composition = await http(`/api/marketplace/v3/supplies/${encodeURIComponent(supply.id)}/order-ids`);
        if (!Array.isArray(composition.orderIds)) throw Error('WB не подтвердил состав поставки.');
        if (same(composition.orderIds.map(String), ids)) found.add(supply.id);
      }
    }
    if (response.next === 0) {
      if (found.size > 1) throw Error('Найдено несколько поставок: требуется разбор.');
      return [...found][0];
    }
    if (response.next === next) throw Error('WB не завершил список поставок.');
    next = response.next;
  }
  throw Error('Список поставок слишком большой для автоматической сверки.');
}

export async function validateRoute(db: Db, connection: any, request: any, links: any[], config: any) {
  if (!connection.isActive || connection.marketplace !== 'WILDBERRIES' || request.clientId !== connection.clientId) throw Error('Кабинет или клиент заявки изменился.');
  const warehouses = [...new Set(links.map(l => l.sellerWarehouseId))];
  if (warehouses.length !== 1 || !warehouses[0]) throw Error('Не определён единый склад WB заявки.');
  const id = warehouses[0];
  if (!config.allWarehouses && !config.warehouseIds.includes(id)) throw Error('Склад исключён из расписания.');
  const route = await db.fbsWarehouseRoutingRule.findFirst({ where: { connectionId: connection.id, marketplaceWarehouseId: id } });
  const warehouseId = route?.mode === 'BRANCH' ? route.executionWarehouseId
    : route?.mode === 'CENTRAL' || ((!route || route.mode === 'DEFAULT') && connection.fbsAutoRouteNewWarehouses) ? connection.fbsExecutionWarehouseId : null;
  if (!warehouseId || warehouseId !== request.warehouseId) throw Error('Маршрутизация заявки изменилась; требуется разбор.');
}

export async function recoverInterrupted(db: Db, connection: any, actor: string, config: any, recover: Function, http: Http) {
  if (!enabled() || connection.marketplace !== 'WILDBERRIES' || !connection.isActive) return [];
  // This routine runs inside withRun's connection lock. Fresh or pre-deployment runs are not stolen.
  const runs = await db.systemSetting.findMany({ where: { key: { startsWith: `fbs.autoAssembly.run.${connection.id}.` } } });
  const stale = runs.filter((r: any) => r.value.status === 'RUNNING' && Date.parse(r.value.startedAt) < Date.now() - 15 * 60000);
  const saved = await db.systemSetting.findMany({ where: { key: { startsWith: prefix + connection.id + '.' } } });
  const operations = saved.filter((r: any) => !['VERIFIED', 'TERMINAL'].includes(r.value.stage)).map((r: any) => r.value);
  // FIX: legacy RUNNING has no request IDs. Only exact automatic creation events in its
  // bounded execution window may be adopted; manually created requests never qualify.
  for (const run of stale) {
    const start = new Date(run.value.startedAt);
    const events = await db.clientRequestEvent.findMany({ where: { eventType: 'CREATED', title: 'Заявка создана автосборкой WMS',
      createdAt: { gte: start, lt: new Date(+start + 10 * 60000) }, request: { clientId: connection.clientId,
        fbsOrderLinks: { some: { connectionId: connection.id, marketplace: 'WILDBERRIES' } } } }, include: { request: true } });
    for (const e of events) {
      if (saved.some((s: any) => s.value.requestId === e.requestId) || operations.some((o: any) => o.requestId === e.requestId)) continue;
      operations.push({ requestId: e.requestId, requestNumber: e.request.number, clientId: connection.clientId,
        connectionId: connection.id, actor, runKey: run.key, groups: [], legacy: true });
    }
  }
  const results: any[] = [];
  operations.sort((a: any,b: any) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  for (const op of operations.slice(0, 20)) {
    const key = prefix + connection.id + '.' + op.requestId;
    try {
      const request = await db.clientRequest.findUnique({ where: { id: op.requestId } });
      if (!request || ['DONE', 'CANCELLED'].includes(request.status)) {
        op.stage = 'TERMINAL'; await save(db,key,{...op,at:new Date().toISOString()},actor); continue;
      }
      if (request.clientId !== connection.clientId) throw Error('Клиент заявки изменился.');
      const links = await db.fbsOrderRequestLink.findMany({ where: { requestId: request.id, clientId: connection.clientId,
        connectionId: connection.id, marketplace: 'WILDBERRIES', syncStatus: 'ACTIVE' } });
      if (!links.length) throw Error('Нет активных заказов заявки.');
      if (op.orderIds && !same(op.orderIds, idsOf(links))) throw Error('Состав заявки изменился; требуется разбор.');
      await validateRoute(db, connection, request, links, config);
      const groups = [...op.groups];
      const uncovered = idsOf(links).filter(id => !groups.some((g: any) => g.orderIds.includes(id)));
      if (uncovered.length) groups.push({ orderIds: uncovered, key: `fbs.autoAssembly.recovery.${connection.id}.${request.id}` });
      for (const group of groups) {
        await recover(db, { connectionId: connection.id, clientId: connection.clientId, actorId: actor,
          requestNumber: request.number, orderIds: group.orderIds, checkpointKey: group.key, durable: true,
          legacy: Boolean(op.legacy), routeConfig: config, allowedWarehouseIds: config.allWarehouses ? undefined : config.warehouseIds,
          http, apply: true });
      }
      op.stage = 'VERIFIED'; delete op.error;
      await save(db, key, { ...op, at: new Date().toISOString() }, actor);
      results.push({ label: `Восстановление №${request.number}`, requestNumber: request.number, count: links.length, stage: 'VERIFIED' });
    } catch (e) {
      op.stage = 'REVIEW_REQUIRED'; op.error = message(e);
      await save(db, key, { ...op, at: new Date().toISOString() }, actor);
      results.push({ label: `Восстановление №${op.requestNumber}`, requestNumber: op.requestNumber, count: 0, error: op.error });
    }
  }
  for (const run of stale) {
    const related = [...operations, ...saved.filter((s: any) => ['VERIFIED','TERMINAL'].includes(s.value.stage)).map((s: any) => s.value)].filter((o: any) => o.runKey === run.key);
    // Do not claim successful recovery when the bounded legacy lookup found no evidence.
    await db.systemSetting.update({ where: { key: run.key }, data: { value: { ...run.value,
      status: related.length && related.every((o: any) => ['VERIFIED','TERMINAL'].includes(o.stage)) ? 'DONE' : 'PARTIAL',
      completedAt: new Date().toISOString(), groups: related.map((o: any) => ({ requestNumber: o.requestNumber,
        stage: o.stage ?? 'PENDING', ...(o.error ? { error: o.error } : {}) })),
      ...(!related.length ? { error: 'Прерванный запуск: состав не восстановлен автоматически.' } : {}) } } });
  }
  return results;
}
