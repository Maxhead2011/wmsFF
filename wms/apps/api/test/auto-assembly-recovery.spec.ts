import { describe, it, expect, vi } from 'vitest';
import { recoverAutoAssemblyRequest, recoverFailedAutoAssemblies } from '../src/modules/marketplace-connections/auto-assembly-recovery';
import { AutoAssemblyService } from '../src/modules/administration/auto-assembly.service';

// TEST: a request committed before a reservation deadlock must resume without a new request or reserve.
function fixture() {
  const state: any = { journal: null, plans: [], status: 'new', composition: [], creates: 0, patches: 0, failCreate: false, failPatch: false, conflict: false };
  const request = { id: 'request', number: 1334, clientId: 'client', warehouseId: 'wms', status: 'SUBMITTED' };
  const links = [{ id: 'link', requestId: 'request', clientId: 'client', connectionId: 'cab', orderId: '10', marketplace: 'WILDBERRIES', syncStatus: 'ACTIVE', sellerWarehouseId: 'seller', sellerWarehouseName: 'Казань', lastSupplyId: null }];
  const tasks = [{ id: 'task', requestId: 'request', clientId: 'client', connectionId: 'cab', orderId: '10', status: 'RESERVED', reservedBoxId: 'box', reservedAt: new Date(), boxId: null, barcode: null, kiz: null, startedAt: null, completedAt: null, supplyId: null }];
  const p: any = {
    clientRequest: { findUniqueOrThrow: vi.fn(async () => request) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => links), updateMany: vi.fn(async () => ({ count: 1 })) },
    fbsTsdAssembly: { findMany: vi.fn(async () => tasks), updateMany: vi.fn(async () => ({ count: 1 })) },
    clientFbsBillingSettings: { findUnique: vi.fn(async () => ({ defaultDeliveryDestination: 'VNUKOVO_SORTING_CENTER' })) },
    systemSetting: { findUnique: vi.fn(async () => state.journal && ({ value: structuredClone(state.journal) })), upsert: vi.fn(async (q: any) => { state.journal = structuredClone(q.update.value); }) },
    fbsSupplyPlan: { findUnique: vi.fn(async () => state.plans[0] ?? null), upsert: vi.fn(async (q: any) => { state.plans = [q.create]; }) },
    auditLog: { create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async () => [{ locked: true }]),
  };
  p.$transaction = vi.fn(async (fn: any) => { if (state.conflict) { state.conflict = false; throw Object.assign(new Error('deadlock'), { code: 'P2034' }); } return fn(p); });
  const http = vi.fn(async (path: string, method = 'GET', body?: any) => {
    if (path.endsWith('/orders/status')) return { orders: [{ id: 10, supplierStatus: state.status, wbStatus: 'waiting' }] };
    if (path.endsWith('/orders/new')) return { orders: [{ id: 10, warehouseId: 'seller', cargoType: 1, crossBorderType: 0 }] };
    if (path === '/api/v3/supplies' && method === 'POST') { state.creates++; if (state.failCreate) throw Error('timeout'); return { id: 'WB-GI-123' }; }
    if (path.endsWith('/order-ids')) return { orderIds: state.composition };
    if (path.endsWith('/orders') && method === 'PATCH') { state.patches++; if (state.failPatch) throw Error('timeout'); state.composition = body.orders; state.status = 'confirm'; return {}; }
    if (path === '/api/v3/supplies/WB-GI-123') return { id: 'WB-GI-123', done: false, destinationOfficeId: 211 };
    throw Error('Unexpected HTTP ' + method + ' ' + path);
  });
  return { state, p, http, tasks, links, request, options: { connectionId: 'cab', clientId: 'client', requestNumber: 1334, actorId: 'admin', supplyHints: [] as string[], http, wait: async () => {}, apply: true } };
}
describe('automatic assembly recovery', () => {
  it('resumes the existing request and preserves its physical reservation', async () => {
    const f = fixture(), before = structuredClone(f.tasks);
    const result = await recoverAutoAssemblyRequest(f.p, f.options);
    expect(result.stage).toBe('VERIFIED'); expect(f.state.creates).toBe(1); expect(f.state.patches).toBe(1);
    expect(f.tasks).toEqual(before); expect(f.state.plans[0].orderIds).toEqual(['10']);
    for (const [q] of f.p.fbsTsdAssembly.updateMany.mock.calls) expect(Object.keys(q.data)).toEqual(['supplyId']);
  });
  it('repairs an existing WB supply without creating or moving anything', async () => {
    const f = fixture(); f.state.status = 'confirm'; f.state.composition = [10]; f.options.supplyHints = ['WB-GI-123'];
    expect((await recoverAutoAssemblyRequest(f.p, f.options)).stage).toBe('VERIFIED');
    expect(f.state.creates).toBe(0); expect(f.state.patches).toBe(0);
  });
  it('never creates a second supply after an ambiguous creation timeout', async () => {
    const f = fixture(); f.state.failCreate = true;
    await expect(recoverAutoAssemblyRequest(f.p, f.options)).rejects.toThrow('timeout');
    f.state.failCreate = false;
    await expect(recoverAutoAssemblyRequest(f.p, f.options)).rejects.toThrow('неизвестен');
    expect(f.state.creates).toBe(1);
  });
  it('reconciles a PATCH timeout from actual composition rather than moving again', async () => {
    const f = fixture(); f.state.failPatch = true;
    await expect(recoverAutoAssemblyRequest(f.p, f.options)).rejects.toThrow('timeout');
    f.state.status = 'confirm'; f.state.composition = [10];
    expect((await recoverAutoAssemblyRequest(f.p, f.options)).stage).toBe('VERIFIED');
    expect(f.state.creates).toBe(1); expect(f.state.patches).toBe(1);
  });
  it('does not mark missing WB composition as a successful recovery', async () => {
    const f = fixture(); f.state.status = 'confirm'; f.options.supplyHints = ['WB-GI-123'];
    await expect(recoverAutoAssemblyRequest(f.p, f.options)).rejects.toThrow('состав');
    expect(f.state.plans).toHaveLength(0);
  });
  it('refuses a foreign order in the target supply', async () => {
    const f = fixture(); f.state.composition = [10, 999]; f.options.supplyHints = ['WB-GI-123'];
    await expect(recoverAutoAssemblyRequest(f.p, f.options)).rejects.toThrow('посторонние'); expect(f.state.patches).toBe(0);
  });
  it('refuses moving a task that was physically started', async () => {
    const f = fixture(); f.tasks[0].startedAt = new Date() as any;
    await expect(recoverAutoAssemblyRequest(f.p, f.options)).rejects.toThrow('отбор'); expect(f.state.creates).toBe(0);
  });
  it('preview is read-only, including journal and reserves', async () => {
    const f = fixture(); f.options.apply = false;
    await recoverAutoAssemblyRequest(f.p, f.options);
    expect(f.state.creates).toBe(0); expect(f.state.patches).toBe(0); expect(f.state.journal).toBeNull(); expect(f.state.plans).toHaveLength(0);
  });
  it('rejects a request belonging to another client', async () => {
    const f = fixture(); f.request.clientId = 'other';
    await expect(recoverAutoAssemblyRequest(f.p, f.options)).rejects.toThrow('клиент'); expect(f.http).not.toHaveBeenCalled();
  });
  it('repeated recovery reads WB but does not duplicate a verified operation', async () => {
    const f = fixture(); await recoverAutoAssemblyRequest(f.p, f.options); await recoverAutoAssemblyRequest(f.p, f.options);
    expect(f.state.creates).toBe(1); expect(f.state.patches).toBe(1);
  });
  it('does not reopen cancelled requests', async () => {
    const f = fixture(); f.request.status = 'CANCELLED';
    await expect(recoverAutoAssemblyRequest(f.p, f.options)).rejects.toThrow('отменена'); expect(f.http).not.toHaveBeenCalled();
  });
  it('does not restore a warehouse removed from the schedule', async () => {
    const f = fixture();
    await expect(recoverAutoAssemblyRequest(f.p, { ...f.options, allowedWarehouseIds: ['different'] })).rejects.toThrow('больше не выбран');
    expect(f.state.creates).toBe(0);
  });
  it('does not change reservations for a customer cancellation', async () => {
    const f = fixture(); f.state.status = 'cancel';
    expect((await recoverAutoAssemblyRequest(f.p, f.options)).stage).toBe('NO_ACTIVE_ORDERS');
    expect(f.p.fbsTsdAssembly.updateMany).not.toHaveBeenCalled(); expect(f.state.creates).toBe(0);
  });
  it('retries a rolled-back plan transaction without replaying WB mutations', async () => {
    const f = fixture(), tx = f.p.$transaction;
    let calls = 0;
    f.p.$transaction = async (fn: any, opt: any) => { calls++; if (calls === 2) throw Object.assign(new Error('deadlock'), { code: 'P2034' }); return tx(fn, opt); };
    expect((await recoverAutoAssemblyRequest(f.p, f.options)).stage).toBe('VERIFIED');
    expect(calls).toBe(3); expect(f.state.creates).toBe(1); expect(f.state.patches).toBe(1);
  });
  it('does not replay the whole operation when the outer lock transaction fails', async () => {
    const f = fixture(); f.state.conflict = true;
    await expect(recoverAutoAssemblyRequest(f.p, f.options)).rejects.toThrow('deadlock'); expect(f.state.creates).toBe(0);
  });
  it('keeps the sold installation unchanged with recovery disabled', async () => {
    vi.stubEnv('WMS_AUTO_ASSEMBLY_ENABLED', 'true'); vi.stubEnv('WMS_AUTO_ASSEMBLY_RECOVERY_ENABLED', 'false');
    expect(await recoverFailedAutoAssemblies({} as any, 'cab', 'admin')).toEqual([]); vi.unstubAllEnvs();
  });
  // TEST: actual scheduler regression: an already-created request was skipped forever after a deadlock.
  it('scheduler resumes the failed existing request before selecting new orders', async () => {
    vi.stubEnv('WMS_AUTO_ASSEMBLY_ENABLED', 'true'); vi.stubEnv('WMS_AUTO_ASSEMBLY_RECOVERY_ENABLED', 'true');
    const f = fixture();
    const connection = { id: 'cab', clientId: 'client', marketplace: 'WILDBERRIES', isActive: true, client: { isDemo: false }, apiKey: 'test' };
    f.p.clientMarketplaceConnection = { findUnique: async () => connection, findUniqueOrThrow: async () => connection };
    f.p.clientRequest.findUnique = async () => f.request;
    f.p.systemSetting.findMany = async () => [{ value: { groups: [{ requestNumber: 1334, error: 'write conflict' }] } }];
    const originalFind = f.p.systemSetting.findUnique;
    f.p.systemSetting.findUnique = async (q: any) => q.where.key.includes('.config.') ? { value: { enabled: true, allWarehouses: true, warehouseIds: [], times: ['09:00'] } } : originalFind(q);
    f.p.systemSetting.create = async () => ({}); f.p.systemSetting.update = async () => ({});
    vi.stubGlobal('fetch', async (url: string, opt: any) => new Response(JSON.stringify(await f.http(new URL(url).pathname, opt.method, opt.body ? JSON.parse(opt.body) : undefined)), { status: 200 }));
    const marketplace = { runAutoAssembly: vi.fn(async () => ({ skipped: 1, groups: [] })) };
    const service = new AutoAssemblyService(f.p, { requireClientAccess() {} } as any, marketplace as any);
    try {
      const result: any = await service.run('cab', { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'] } as any);
      expect(result.groups).toContainEqual(expect.objectContaining({ requestNumber: 1334, stage: 'VERIFIED' }));
      expect(f.state.creates).toBe(1); expect(f.state.plans).toHaveLength(1);
    } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
  });
});
