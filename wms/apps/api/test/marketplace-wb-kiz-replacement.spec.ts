import { ConflictException } from '@nestjs/common';
import { MarketplaceType, StockStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: public scanner contract; real preflight, history and optimistic lease guards.
// No real WB/DB, timers, managers or credentials are involved in this fixture.
const ORDER_ID = '5360364181';
const NEW_KIZ = '010590000000001221PHYSICAL123456\u001d91NEW';
const OLD_KIZ_VALUES = [
  '010590000000001221OLDREMOTE12345\u001d91OLD',
  '010590000000001221OLDREMOTE67890\u001d91SECOND',
];
const FOREIGN_KIZ = '010590000000001221SOMEONEELSE123\u001d91OTHER';
const STARTED = 'FBS_WB_KIZ_REPLACEMENT_STARTED';
const ACCEPTED = 'FBS_KIZ_SCAN_ACCEPTED';
const user: AuthUser = {
  id: 'worker-1', name: 'Сборщик', email: 'worker@example.test',
  roleCodes: ['WAREHOUSE_KEEPER'], permissionCodes: ['stock:read', 'stock:write'],
  clientScopeMode: 'LIMITED', clientIds: ['client-1'], writableClientIds: ['client-1'],
  deviceCode: 'TSD-1', deviceId: 'device-1', activeWarehouseId: 'warehouse-1',
  warehouseIds: ['warehouse-1'], writableWarehouseIds: ['warehouse-1'],
};

type Row = Record<string, any>;
type Options = {
  attached?: boolean;
  supplierStatus?: string;
  foreignSku?: boolean;
  history?: 'ASSEMBLY' | 'SHIPMENT' | 'PRINT';
  auditFailure?: boolean;
  auditLookupFailure?: boolean;
  registeredMark?: boolean;
  deleteUnknown?: boolean;
  putOutcome?: 'ok' | 'timeout' | 'timeout-accepted' | 'error';
  readback?: 'unavailable' | 'empty' | 'old' | 'foreign' | 'non-confirm' | 'incomplete';
  loseLeaseAt?: 'initial' | 'pre-delete' | 'after-delete' | 'readback';
  scanOutcomes?: Array<Pick<Options, 'putOutcome' | 'readback'>>;
};
type WbWrite = {
  method: string; url: string; body: Row | undefined;
  taskBefore: Row; auditsBefore: Row[];
};

const copy = <T>(value: T): T => structuredClone(value);

// TEST: CAS genuinely compares the version/owner; missing guards cannot turn stale writes green.
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'AND') return (Array.isArray(expected) ? expected : [expected]).every((clause) => matches(row, clause));
    const actual = row[key];
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('path' in expected) {
        const value = expected.path.reduce((current: unknown, part: string) =>
          current && typeof current === 'object' ? (current as Row)[part] : undefined, actual);
        return value === expected.equals;
      }
      if ('equals' in expected) {
        return expected.mode === 'insensitive'
          ? String(actual).toLowerCase() === String(expected.equals).toLowerCase()
          : actual === expected.equals;
      }
      if ('not' in expected) return actual !== expected.not;
      if ('in' in expected) return expected.in.includes(actual);
      if ('notIn' in expected) return !expected.notIn.includes(actual);
      throw new Error(`Unmodelled test predicate: ${key}`);
    }
    return actual === expected;
  });
}

function fixture(options: Options = {}) {
  const task: Row = {
    id: 'task-1', clientId: 'client-1', requestId: 'request-1', connectionId: 'connection-1',
    orderId: ORDER_ID, marketplace: MarketplaceType.WILDBERRIES,
    skuId: 'sku-1', productName: 'Тестовый товар', article: 'ARTICLE-1', itemCount: 1,
    requiresKiz: true, status: 'IN_PROGRESS', workerUserId: user.id, workerName: user.name,
    deviceCode: user.deviceCode, boxId: 'box-1', boxCode: 'FFL_TEST_001',
    barcode: '4600000000012', barcodes: ['4600000000012'], kiz: null,
    wbMetaStatus: 'PENDING', errorMessage: null, relabelRequired: false,
    relabelConfirmedAt: null, sourceSkuId: null, completedAt: null,
    createdAt: new Date('2026-09-05T09:00:00.000Z'),
    updatedAt: new Date('2026-09-05T09:00:00.000Z'),
  };
  const initialTask = copy(task);
  const mark: Row = {
    id: 'mark-1', value: NEW_KIZ, clientId: 'client-1',
    skuId: options.foreignSku ? 'foreign-sku' : 'sku-1', boxId: 'box-1',
    status: StockStatus.AVAILABLE, sourceDocument: 'Тестовая приёмка',
    box: { code: 'FFL_TEST_001' },
    sku: { internalSku: 'SKU-1', article: 'ARTICLE-1', name: 'Тестовый товар', color: null, size: null },
  };
  const state = {
    task, mark: options.registeredMark === false ? null as Row | null : copy(mark),
    audits: [] as Row[], events: [] as string[], wbWrites: [] as WbWrite[],
    remote: options.attached ? [NEW_KIZ] : [...OLD_KIZ_VALUES],
    reads: { status: 0, meta: 0 }, scanReads: { status: 0, meta: 0 }, scanNumber: 0,
    taskAtLeaseLoss: null as Row | null,
  };
  function loseLease() {
    state.task = {
      ...state.task, workerUserId: 'other-worker', deviceCode: 'TSD-OTHER',
      updatedAt: new Date(state.task.updatedAt.getTime() + 1),
    };
    state.taskAtLeaseLoss = copy(state.task);
    state.events.push('lease:lost');
  }
  if (options.loseLeaseAt === 'initial') loseLease();
  function updateTask(data: Row) {
    state.task = { ...state.task, ...copy(data), updatedAt: new Date(state.task.updatedAt.getTime() + 1) };
    state.events.push('task:write');
    return copy(state.task);
  }
  function historyRow() {
    return { id: 'previous-task', orderId: '1002', requestId: 'previous-request',
      completedAt: new Date('2026-09-04T09:00:00Z'), shippedAt: new Date('2026-09-04T09:00:00Z') };
  }
  const writeSpies = () => ({
    create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(),
  });
  const prisma = {
    fbsTsdAssembly: {
      findUnique: vi.fn(async ({ where }: Row) => where.id === 'task-1' ? copy(state.task) : null),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async ({ where }: Row) =>
        options.history === 'ASSEMBLY' && where.wbMetaStatus === 'ACCEPTED' ? historyRow() : null),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        if (!matches(state.task, where)) return { count: 0 };
        updateTask(data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        if (!matches(state.task, where)) throw new Error('Task update did not match');
        return updateTask(data);
      }),
    },
    productMark: {
      findFirst: vi.fn(async ({ where }: Row) => state.mark && matches(state.mark, where) ? copy(state.mark) : null),
      findUnique: vi.fn(async () => copy(state.mark)),
      count: vi.fn(async () => state.mark ? 1 : 0),
      create: vi.fn(async ({ data }: Row) => {
        state.mark = { ...copy(mark), ...copy(data) };
        state.events.push('mark:create');
        return copy(state.mark);
      }),
      update: vi.fn(async ({ data }: Row) => {
        state.mark = { ...state.mark, ...copy(data) };
        state.events.push('mark:update');
        return copy(state.mark);
      }),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        if (!state.mark || !matches(state.mark, where)) return { count: 0 };
        state.mark = { ...state.mark, ...copy(data) };
        state.events.push('mark:updateMany');
        return { count: 1 };
      }),
      deleteMany: vi.fn(async ({ where }: Row) => {
        if (!state.mark || !matches(state.mark, where)) return { count: 0 };
        state.mark = null;
        state.events.push('mark:delete');
        return { count: 1 };
      }),
    },
    shippedKizHistory: { findFirst: vi.fn(async () => options.history === 'SHIPMENT' ? historyRow() : null) },
    fbsWebKizStickerPrint: { findFirst: vi.fn(async () => options.history === 'PRINT' ? historyRow() : null) },
    clientRequest: {
      findUnique: vi.fn(async () => ({ id: 'request-1', fbsEmergencyAssemblyAt: null })),
      findMany: vi.fn(async () => []),
    },
    clientMarketplaceConnection: { findFirst: vi.fn(async () => ({ apiKey: 'test-only-wb-key' })) },
    stockBalance: { ...writeSpies(), aggregate: vi.fn(async () => ({ _sum: { quantity: 3 } })) },
    stockMovement: { ...writeSpies(), findFirst: vi.fn(async () => null) },
    fbsOrderRequestLink: { updateMany: vi.fn(async () => ({ count: 1 })) },
    clientRequestEvent: { create: vi.fn(async () => ({})) },
    auditLog: {
      // TEST: replacement recovery is scoped to this task, scan and marketplace context.
      findFirst: vi.fn(async ({ where }: Row) => {
        if (where.action === STARTED && options.auditLookupFailure) throw new Error('Audit lookup unavailable');
        return copy([...state.audits].reverse().find((audit) => matches(audit, where)) ?? null);
      }),
      create: vi.fn(async ({ data }: Row) => {
        if (data.action === STARTED && options.auditFailure) throw new Error('Audit storage unavailable');
        state.audits.push(copy(data));
        state.events.push(`audit:${data.action}`);
        return { id: `audit-${state.audits.length}`, ...copy(data) };
      }),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (operation: (tx: typeof prisma) => Promise<unknown>) => {
    const before = copy({ task: state.task, mark: state.mark, audits: state.audits });
    try { return await operation(prisma); }
    catch (error) {
      state.task = before.task; state.mark = before.mark; state.audits = before.audits;
      throw error;
    }
  });

  const service = new MarketplaceConnectionsService(prisma as never, {} as never);
  vi.spyOn(service as any, 'loadOwnedFbsTsdAssembly').mockImplementation(async () =>
    copy(options.loseLeaseAt === 'initial' ? initialTask : state.task));
  vi.spyOn(service as any, 'formatFbsTsdAssembly').mockImplementation(async (updated: Row, _user: AuthUser, message: string) =>
    ({ task: copy(updated), message }));
  const reserve = vi.spyOn(service as any, 'reserveAcceptedWildberriesStock').mockResolvedValue(undefined);

  const response = (payload: Row, status = 200) => new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const behavior = options.scanOutcomes?.[state.scanNumber - 1] ?? options;
    const url = String(input);
    const method = init.method || 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const isStatus = url === 'https://marketplace-api.wildberries.ru/api/v3/orders/status';
    const isMeta = url === 'https://marketplace-api.wildberries.ru/api/marketplace/v3/orders/meta';
    if (isStatus || isMeta) {
      if (method !== 'POST' || JSON.stringify(body) !== JSON.stringify({ orders: [Number(ORDER_ID)] })) {
        throw new Error('Unexpected WB preflight request');
      }
      const kind = isStatus ? 'status' : 'meta';
      state.reads[kind]++;
      const readNumber = ++state.scanReads[kind];
      state.events.push(`read:${kind}:${readNumber}`);
      if (isMeta && readNumber === 1 && options.loseLeaseAt === 'pre-delete') loseLease();
      if (isMeta && readNumber > 1 && options.loseLeaseAt === 'readback') loseLease();
      if (readNumber > 1 && behavior.readback === 'unavailable') return response({ message: 'WB readback unavailable' }, 503);
      if (isMeta && readNumber > 1 && behavior.readback === 'incomplete') return response({ orders: [{ id: Number(ORDER_ID) }] });
      let values = state.remote;
      if (readNumber > 1 && behavior.readback === 'old') values = OLD_KIZ_VALUES;
      if (readNumber > 1 && behavior.readback === 'foreign') values = [FOREIGN_KIZ];
      if (readNumber > 1 && ['empty', 'non-confirm'].includes(behavior.readback ?? '')) values = [];
      return response(isStatus
        ? { orders: [{ id: Number(ORDER_ID), supplierStatus: readNumber > 1 && behavior.readback === 'non-confirm'
          ? 'complete' : options.supplierStatus ?? 'confirm', wbStatus: 'waiting' }] }
        : { orders: [{ id: Number(ORDER_ID), meta: { sgtin: { value: values } } }] });
    }
    if (!['DELETE', 'PUT'].includes(method)) throw new Error(`Unexpected mocked WB request: ${method} ${url}`);
    state.wbWrites.push({ method, url, body, taskBefore: copy(state.task), auditsBefore: copy(state.audits) });
    state.events.push(`wb:${method}`);
    if (method === 'DELETE') {
      if (options.loseLeaseAt === 'after-delete') loseLease();
      if (options.deleteUnknown) throw new Error('DELETE timeout: acknowledgement unavailable');
      state.remote = [];
      return response({});
    }
    if (JSON.stringify(body?.sgtins) === JSON.stringify([NEW_KIZ])) {
      if (behavior.putOutcome === 'timeout-accepted') {
        state.remote = [NEW_KIZ];
        throw new Error('PUT timeout: WB applied request, acknowledgement lost');
      }
      if (behavior.putOutcome === 'timeout') throw new Error('PUT timeout: result unknown');
      if (behavior.putOutcome === 'error') return response({ message: 'Replacement rejected' }, 400);
      state.remote = [NEW_KIZ];
      return response({});
    }
    // TEST: old/foreign arrays must never be PUT, even after an empty readback.
    throw new Error('Unexpected mocked PUT body');
  });
  vi.stubGlobal('fetch', fetchMock);
  return { state, prisma, reserve, fetchMock,
    scan: () => {
      state.scanNumber++;
      state.scanReads = { status: 0, meta: 0 };
      state.events.push(`scan:${state.scanNumber}`);
      return service.scanFbsTsdKiz('task-1', { kiz: NEW_KIZ }, user);
    } };
}

type Fixture = ReturnType<typeof fixture>;
function expectNoStockWrites(f: Fixture) {
  for (const model of [f.prisma.stockBalance, f.prisma.stockMovement]) {
    for (const name of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'] as const) {
      expect(model[name], `stock write: ${name}`).not.toHaveBeenCalled();
    }
  }
}
function expectNoAcceptance(f: Fixture) {
  expect(f.reserve).not.toHaveBeenCalled();
  expect(f.state.audits.filter((audit) => audit.action === ACCEPTED)).toEqual([]);
  expectNoStockWrites(f);
}
function expectDurableStart(f: Fixture, attempts = 1) {
  const starts = f.state.audits.filter((audit) => audit.action === STARTED);
  expect(starts).toHaveLength(attempts);
  expect(starts[0]).toMatchObject({ entity: 'FbsTsdAssembly', entityId: 'task-1', userId: user.id,
    payload: { previousKizValues: OLD_KIZ_VALUES, scannedKiz: NEW_KIZ } });
}
function expectPending(f: Fixture, attempts = 1) {
  expect(f.state.task).toMatchObject({ status: 'IN_PROGRESS', workerUserId: user.id,
    deviceCode: user.deviceCode, kiz: NEW_KIZ, wbMetaStatus: 'PENDING' });
  expect(f.state.task.errorMessage).toEqual(expect.any(String));
  expect(f.state.task.errorMessage.length).toBeGreaterThan(10);
  expectNoAcceptance(f);
  expectDurableStart(f, attempts);
  expect(f.prisma.productMark.deleteMany).not.toHaveBeenCalled();
  expect(f.prisma.productMark.updateMany).not.toHaveBeenCalled();
}
async function expectScanError(f: Fixture) {
  const outcome = await f.scan().then(() => null, (error: unknown) => error);
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
}
async function expectStale(f: Fixture) {
  const error = await expectScanError(f);
  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).getResponse()).toMatchObject({ code: 'FBS_TASK_STALE' });
  expect(f.state.task).toEqual(f.state.taskAtLeaseLoss);
  expect(f.state.events.slice(f.state.events.indexOf('lease:lost') + 1)).not.toContain('task:write');
  expectNoAcceptance(f);
}

describe('scanFbsTsdKiz: safe automatic WB KIZ replacement', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('persists raw old/new evidence and PENDING before DELETE, then PUTs only the scan and accepts without a manager', async () => {
    const f = fixture();
    const result = await f.scan();
    expect(f.state.wbWrites.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      { method: 'DELETE', url: `https://marketplace-api.wildberries.ru/api/v3/orders/${ORDER_ID}/meta?key=sgtin`, body: undefined },
      { method: 'PUT', url: `https://marketplace-api.wildberries.ru/api/v3/orders/${ORDER_ID}/meta/sgtin`, body: { sgtins: [NEW_KIZ] } },
    ]);
    const deletion = f.state.wbWrites[0];
    expect(deletion.taskBefore).toMatchObject({ kiz: NEW_KIZ, wbMetaStatus: 'PENDING', workerUserId: user.id });
    expect(deletion.auditsBefore).toContainEqual(expect.objectContaining({ action: STARTED,
      payload: expect.objectContaining({ previousKizValues: OLD_KIZ_VALUES, scannedKiz: NEW_KIZ }) }));
    expectDurableStart(f);
    expect(result).toMatchObject({ task: { kiz: NEW_KIZ, wbMetaStatus: 'ACCEPTED', status: 'IN_PROGRESS' } });
    expect(f.reserve).toHaveBeenCalledTimes(1);
    expect(f.reserve).toHaveBeenCalledWith(expect.objectContaining({ kiz: NEW_KIZ, wbMetaStatus: 'ACCEPTED' }));
    expect(f.state.audits.filter((audit) => audit.action === ACCEPTED)).toHaveLength(1);
    expect(f.prisma.clientRequestEvent.create).not.toHaveBeenCalled();
    expect(f.prisma.fbsOrderRequestLink.updateMany).not.toHaveBeenCalled();
    expectNoStockWrites(f);
  });

  it('fails closed if durable replacement audit cannot be written, before any WB mutation', async () => {
    const f = fixture({ auditFailure: true });
    const error = await expectScanError(f);
    expect(error.message).toMatch(/audit|аудит|журнал|сохран/i);
    expect(f.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: STARTED }) }));
    expect(f.state.wbWrites).toEqual([]);
    expect(f.state.audits.filter((audit) => audit.action === STARTED)).toEqual([]);
    expectNoAcceptance(f);
  });

  it('accepts an already attached scan even outside confirm without DELETE or PUT', async () => {
    const f = fixture({ attached: true, supplierStatus: 'complete' });
    await f.scan();
    expect(f.state.task).toMatchObject({ kiz: NEW_KIZ, wbMetaStatus: 'ACCEPTED' });
    expect(f.state.wbWrites).toEqual([]);
    expect(f.state.reads).toEqual({ status: 1, meta: 1 });
    expect(f.reserve).toHaveBeenCalledTimes(1);
    expect(f.state.audits.filter((audit) => audit.action === STARTED)).toEqual([]);
  });

  it('does not replace another remote KIZ when the WB order is not confirm', async () => {
    const f = fixture({ supplierStatus: 'complete' });
    expect((await expectScanError(f)).message).toMatch(/confirm|статус/i);
    expect(f.state.wbWrites).toEqual([]);
    expect(f.state.audits.filter((audit) => audit.action === STARTED)).toEqual([]);
    expectNoAcceptance(f);
  });

  it('preserves the foreign-SKU guard before any WB request or mark/stock mutation', async () => {
    const f = fixture({ foreignSku: true });
    expect((await expectScanError(f)).message).toContain('Этот КИЗ относится к другому товару');
    expect(f.fetchMock).not.toHaveBeenCalled();
    expect(f.prisma.productMark.update).not.toHaveBeenCalled();
    expectNoAcceptance(f);
  });

  it.each(['ASSEMBLY', 'SHIPMENT', 'PRINT'] as const)('preserves the real %s history guard before WB mutation', async (history) => {
    const f = fixture({ history });
    expect((await expectScanError(f)).message).toContain('Этот КИЗ уже передавался в Wildberries для заказа 1002');
    expect(f.fetchMock).not.toHaveBeenCalled();
    expect(f.prisma.fbsTsdAssembly.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ wbMetaStatus: 'ACCEPTED' }) }));
    expect(f.prisma.shippedKizHistory.findFirst).toHaveBeenCalled();
    expect(f.prisma.fbsWebKizStickerPrint.findFirst).toHaveBeenCalled();
    expectNoAcceptance(f);
  });

  it('rejects a stale initial lease using the real database version guard', async () => {
    const f = fixture({ loseLeaseAt: 'initial' });
    await expectStale(f);
    expect(f.fetchMock).not.toHaveBeenCalled();
    expect(f.prisma.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });

  it('rechecks the lease after preflight and before DELETE', async () => {
    const f = fixture({ loseLeaseAt: 'pre-delete' });
    await expectStale(f);
    expect(f.state.reads).toEqual({ status: 1, meta: 1 });
    expect(f.state.wbWrites).toEqual([]);
  });

  it('does not PUT or write stale local state if ownership changes during DELETE', async () => {
    const f = fixture({ loseLeaseAt: 'after-delete' });
    await expectStale(f);
    expect(f.state.wbWrites.map((write) => write.method)).toEqual(['DELETE']);
    expectDurableStart(f);
  });

  it('accepts a PUT timeout only after real readback proves the new KIZ is already attached, without restoring', async () => {
    const f = fixture({ putOutcome: 'timeout-accepted' });
    await f.scan();
    expect(f.state.wbWrites.map((write) => write.method)).toEqual(['DELETE', 'PUT']);
    expect(f.state.reads).toEqual({ status: 2, meta: 2 });
    expect(f.state.task).toMatchObject({ kiz: NEW_KIZ, wbMetaStatus: 'ACCEPTED' });
    expect(f.reserve).toHaveBeenCalledTimes(1);
    expectDurableStart(f);
  });

  it('keeps the newly registered physical mark and same PENDING KIZ when PUT result and readback are unknown', async () => {
    const f = fixture({ registeredMark: false, putOutcome: 'timeout', readback: 'unavailable' });
    await expectScanError(f);
    expectPending(f);
    expect(f.state.wbWrites.map((write) => write.method)).toEqual(['DELETE', 'PUT']);
    expect(f.state.reads).toEqual({ status: 2, meta: 2 });
    expect(f.prisma.productMark.create).toHaveBeenCalledTimes(1);
    expect(f.state.mark).toMatchObject({ value: NEW_KIZ, status: StockStatus.AVAILABLE });
  });

  it('keeps durable PENDING evidence on unknown DELETE outcome and unavailable readback, without a blind PUT', async () => {
    const f = fixture({ deleteUnknown: true, readback: 'unavailable' });
    await expectScanError(f);
    expectPending(f);
    expect(f.state.wbWrites.map((write) => write.method)).toEqual(['DELETE']);
    expect(f.state.reads).toEqual({ status: 2, meta: 2 });
  });

  it('keeps the new scan PENDING on fresh empty metadata plus confirm, without any compensating PUT', async () => {
    const f = fixture({ putOutcome: 'error', readback: 'empty' });
    await expectScanError(f);
    expectPending(f);
    expect(f.state.wbWrites.map((write) => [write.method, write.body])).toEqual([
      ['DELETE', undefined], ['PUT', { sgtins: [NEW_KIZ] }],
    ]);
    expect(f.state.remote).toEqual([]);
    expect(f.state.reads).toEqual({ status: 2, meta: 2 });
  });

  it('does not treat incomplete metadata as proof of emptiness or permission for another remote write', async () => {
    const f = fixture({ putOutcome: 'error', readback: 'incomplete' });
    await expectScanError(f);
    expectPending(f);
    expect(f.state.wbWrites.map((write) => write.method)).toEqual(['DELETE', 'PUT']);
    expect(f.state.reads).toEqual({ status: 2, meta: 2 });
    expect(f.state.mark).toMatchObject({ value: NEW_KIZ, status: StockStatus.AVAILABLE });
  });

  it.each(['old', 'foreign', 'non-confirm'] as const)('never restores over %s readback state after PUT failure', async (readback) => {
    const f = fixture({ putOutcome: 'error', readback });
    await expectScanError(f);
    expectPending(f);
    expect(f.state.wbWrites.map((write) => write.method)).toEqual(['DELETE', 'PUT']);
    expect(f.state.reads).toEqual({ status: 2, meta: 2 });
  });

  it('does not mutate local state for the former owner if the lease changes during error readback', async () => {
    const f = fixture({ putOutcome: 'error', readback: 'empty', loseLeaseAt: 'readback' });
    await expectStale(f);
    expect(f.state.wbWrites.map((write) => write.method)).toEqual(['DELETE', 'PUT']);
    expectDurableStart(f);
  });

  // TEST: an unknown replacement must retain its safe recovery semantics across manual scans.
  it('keeps an empty-remote replacement retry PENDING after another lost PUT acknowledgement, then accepts by readback only', async () => {
    const f = fixture({ registeredMark: false, scanOutcomes: [
      { putOutcome: 'timeout', readback: 'unavailable' },
      { putOutcome: 'timeout-accepted', readback: 'unavailable' },
      {},
    ] });
    await expectScanError(f);
    expectPending(f);
    expect(f.state.remote).toEqual([]);
    expect(f.state.wbWrites.map((write) => write.method)).toEqual(['DELETE', 'PUT']);
    const markAfterFirstScan = copy(f.state.mark);

    await expectScanError(f);
    expectPending(f, 2);
    expect(f.state.remote).toEqual([NEW_KIZ]);
    expect(f.state.mark).toEqual(markAfterFirstScan);
    expect(f.state.wbWrites.map((write) => [write.method, write.body])).toEqual([
      ['DELETE', undefined], ['PUT', { sgtins: [NEW_KIZ] }], ['PUT', { sgtins: [NEW_KIZ] }],
    ]);
    expect(f.state.reads).toEqual({ status: 4, meta: 4 });
    // TEST: the second attempt records its current empty preimage before PUT;
    // the first attempt's exact old array is retained, never overwritten.
    const retryAudits = f.state.wbWrites[2].auditsBefore.filter((audit) => audit.action === STARTED);
    expect(retryAudits).toHaveLength(2);
    expect(retryAudits[1].payload).toMatchObject({ previousKizValues: [], scannedKiz: NEW_KIZ });
    expect(f.prisma.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      action: STARTED, entity: 'FbsTsdAssembly', entityId: 'task-1',
      AND: expect.arrayContaining([
        { payload: { path: ['scannedKiz'], equals: NEW_KIZ } },
        { payload: { path: ['clientId'], equals: 'client-1' } },
        { payload: { path: ['connectionId'], equals: 'connection-1' } },
        { payload: { path: ['orderId'], equals: ORDER_ID } },
      ]),
    }) }));

    const result = await f.scan();
    expect(result).toMatchObject({ task: { kiz: NEW_KIZ, wbMetaStatus: 'ACCEPTED', status: 'IN_PROGRESS' } });
    expect(f.state.reads).toEqual({ status: 5, meta: 5 });
    expect(f.state.wbWrites).toHaveLength(3);
    expect(f.reserve).toHaveBeenCalledTimes(1);
    expect(f.state.audits.filter((audit) => audit.action === ACCEPTED)).toHaveLength(1);
    expectDurableStart(f, 2);
    expect(f.prisma.productMark.create).toHaveBeenCalledTimes(1);
    expect(f.prisma.productMark.deleteMany).not.toHaveBeenCalled();
    expect(f.prisma.productMark.updateMany).not.toHaveBeenCalled();
    expectNoStockWrites(f);
  });

  it('preserves legacy explicit rejection for a first empty-remote attachment with same pending KIZ but no replacement audit', async () => {
    const f = fixture({ putOutcome: 'error' });
    f.state.task.kiz = NEW_KIZ;
    f.state.remote = [];
    expect(f.state.audits).toEqual([]);
    expect((await expectScanError(f)).message).toContain('Wildberries не принял КИЗ');
    expect(f.state.task).toMatchObject({ kiz: NEW_KIZ, wbMetaStatus: 'REJECTED', status: 'IN_PROGRESS' });
    expect(f.state.wbWrites.map((write) => [write.method, write.body])).toEqual([['PUT', { sgtins: [NEW_KIZ] }]]);
    expect(f.state.reads).toEqual({ status: 1, meta: 1 });
    expect(f.state.audits.filter((audit) => audit.action === STARTED)).toEqual([]);
    expectNoAcceptance(f);
  });

  it('does not treat near-miss replacement audits from another action, entity, task, KIZ or marketplace context as recovery authority', async () => {
    const f = fixture({ putOutcome: 'error' });
    f.state.task.kiz = NEW_KIZ;
    f.state.remote = [];
    const audit = { action: STARTED, entity: 'FbsTsdAssembly', entityId: 'task-1', payload: {
      scannedKiz: NEW_KIZ, previousKizValues: OLD_KIZ_VALUES,
      clientId: 'client-1', connectionId: 'connection-1', orderId: ORDER_ID,
    } };
    f.state.audits.push(
      { ...copy(audit), action: 'UNRELATED_ACTION' },
      { ...copy(audit), entity: 'ClientRequest' },
      { ...copy(audit), entityId: 'task-other' },
      { ...copy(audit), payload: { ...copy(audit.payload), scannedKiz: FOREIGN_KIZ } },
      { ...copy(audit), payload: { ...copy(audit.payload), clientId: 'client-other' } },
      { ...copy(audit), payload: { ...copy(audit.payload), connectionId: 'connection-other' } },
      { ...copy(audit), payload: { ...copy(audit.payload), orderId: '9999' } },
    );
    const before = copy(f.state.audits);
    expect((await expectScanError(f)).message).toContain('Wildberries не принял КИЗ');
    expect(f.state.task).toMatchObject({ kiz: NEW_KIZ, wbMetaStatus: 'REJECTED' });
    expect(f.state.wbWrites.map((write) => write.method)).toEqual(['PUT']);
    expect(f.state.reads).toEqual({ status: 1, meta: 1 });
    expect(f.state.audits.slice(0, before.length)).toEqual(before);
    expect(f.prisma.auditLog.create).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: STARTED }) }));
    expectNoAcceptance(f);
  });

  it('fails closed before any WB mutation when the pending replacement audit lookup is unavailable', async () => {
    const f = fixture({ auditLookupFailure: true, putOutcome: 'error' });
    f.state.task.kiz = NEW_KIZ;
    f.state.remote = [];
    const before = copy(f.state.task);
    expect((await expectScanError(f)).message).toMatch(/audit|аудит|журнал/i);
    expect(f.state.task).toEqual(before);
    expect(f.state.wbWrites).toEqual([]);
    expect(f.prisma.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
    expect(f.prisma.productMark.create).not.toHaveBeenCalled();
    expectNoAcceptance(f);
  });
});
