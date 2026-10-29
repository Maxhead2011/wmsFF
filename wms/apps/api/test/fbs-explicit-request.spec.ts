import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

const Service = process.env.WMS_FBS_SCOPE_RUNTIME
  ? createRequire(import.meta.url)(process.env.WMS_FBS_SCOPE_RUNTIME).MarketplaceConnectionsService
  : MarketplaceConnectionsService;
const user = { id: 'picker', name: 'Picker', roleCodes: ['WORKER'] } as any;

function fixture() {
  const requests = ['korolev', 'balandin', 'lukin'].map((name, i) => ({
    id: `request-${name}`, clientId: `client-${name}`, status: 'IN_WORK', number: i + 1,
  }));
  const tasks = requests.map((request, i) => ({ id: `task-${i}`, requestId: request.id,
    clientId: request.clientId, marketplace: i === 1 ? 'OZON' : 'WILDBERRIES',
    orderId: `order-${i}`, connectionId: `connection-${i}`, deviceCode: 'TSD-1',
    status: i === 0 ? 'COMPLETED' : 'RESCAN_REQUIRED', workerUserId: i === 0 ? user.id : null,
    updatedAt: new Date(), boxCode: null, boxId: null, sourceBarcode: null, barcode: null, kiz: null,
  }));
  const orders = tasks.map((task, i) => ({ id: task.orderId, marketplace: task.marketplace,
    connectionId: task.connectionId, request: requests[i], category: 'active',
    supplierStatus: i === 1 ? 'awaiting_packaging' : 'confirm', product: { id: `sku-${i}` }, storageBoxes: [],
  }));
  const db = {
    fbsTsdAssembly: {
      findFirst: vi.fn(async ({ where }: any) => tasks.find(t => t.status === where.status &&
        (!where.workerUserId || t.workerUserId === where.workerUserId) &&
        (!where.requestId || t.requestId === where.requestId)) ?? null),
      findUnique: vi.fn(async ({ where }: any) => tasks.find(t => where.id ? t.id === where.id :
        t.orderId === where.marketplace_connectionId_orderId.orderId) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const task = tasks.find(t => t.id === where.id && t.status === where.status);
        if (!task) return { count: 0 };
        Object.assign(task, data); return { count: 1 };
      }),
      create: vi.fn(),
    },
    clientRequest: { findUnique: vi.fn(async ({ where }: any) => requests.find(r => r.id === where.id)) },
    clientMarketplaceConnection: { findMany: vi.fn(async ({ where }: any) => requests
      .filter(r => !where.clientId || r.clientId === where.clientId).map(r => ({ clientId: r.clientId }))) },
  };
  const scopes = { requireClientAccess: vi.fn(), resolveClientFilter: vi.fn(() => undefined) };
  const service: any = new Service(db as never, scopes as never);
  vi.spyOn(service, 'loadFbsTsdRequestOrders').mockImplementation(async (clientId: any) => ({
    orders: orders.filter(o => o.request.clientId === clientId),
  }));
  vi.spyOn(service, 'parkFbsTsdAssignmentFromClosedRequest').mockResolvedValue(false);
  vi.spyOn(service, 'releaseUntouchedFbsTsdAssignmentAwaitingWbConfirmation').mockResolvedValue(false);
  vi.spyOn(service, 'formatFbsTsdAssembly').mockImplementation(async (task: any) => ({ state: 'SCAN_BOX', task }));
  vi.spyOn(service, 'emptyFbsTsdAssembly').mockImplementation(async (_device: any, _user: any, message: any) => ({ state: 'EMPTY', task: null, message }));
  vi.stubEnv('WMS_FBS_TSD_FAST_LOCAL_ENABLED', 'true');
  return { service, db, tasks, scopes };
}

afterEach(() => vi.unstubAllEnvs());

describe('explicit FBS request selection on our WMS', () => {
  // TEST: a completed WB Korolev request must not allocate Ozon Balandin, then WB Lukin.
  it.each([undefined, '', '   '])('does not claim any new task without a request (%s)', async selected => {
    vi.stubEnv('WMS_FBS_EXPLICIT_REQUEST_ENABLED', 'true');
    const f = fixture();
    for (let i = 0; i < 2; i++) {
      const result = await f.service.getNextFbsTsdAssembly('TSD-1', user, selected);
      expect(result.state).toBe('EMPTY'); expect(result.task).toBeNull();
      expect(result.message).toContain('вручную');
    }
    expect(f.db.clientMarketplaceConnection.findMany).not.toHaveBeenCalled();
    expect(f.service.loadFbsTsdRequestOrders).not.toHaveBeenCalled();
    expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
    expect(f.db.fbsTsdAssembly.create).not.toHaveBeenCalled();
    expect(f.tasks.map(t => t.status)).toEqual(['COMPLETED', 'RESCAN_REQUIRED', 'RESCAN_REQUIRED']);
  });

  // TEST: the old terminal can finish its own already assigned physical work.
  it('resumes an existing assignment without selecting a different task', async () => {
    vi.stubEnv('WMS_FBS_EXPLICIT_REQUEST_ENABLED', 'true');
    const f = fixture(); Object.assign(f.tasks[0], { status: 'IN_PROGRESS', barcode: 'scanned' });
    expect((await f.service.getNextFbsTsdAssembly('TSD-1', user, '')).task.id).toBe('task-0');
    expect(f.db.clientMarketplaceConnection.findMany).not.toHaveBeenCalled();
    expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });

  it.each(['request-balandin', 'request-lukin'])('allocates only the explicitly selected request %s', async selected => {
    vi.stubEnv('WMS_FBS_EXPLICIT_REQUEST_ENABLED', 'true');
    const f = fixture();
    const result = await f.service.getNextFbsTsdAssembly('TSD-1', user, selected);
    expect(result.task.requestId).toBe(selected);
    expect(f.db.fbsTsdAssembly.updateMany).toHaveBeenCalledTimes(1);
    expect(f.scopes.requireClientAccess).toHaveBeenCalledWith(user, selected.replace('request-', 'client-'), 'write');
  });

  it('keeps a finished selected request empty even when other clients have work', async () => {
    vi.stubEnv('WMS_FBS_EXPLICIT_REQUEST_ENABLED', 'true');
    const f = fixture();
    expect((await f.service.getNextFbsTsdAssembly('TSD-1', user, 'request-korolev')).state).toBe('EMPTY');
    expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a different selected request while physical work is unfinished', async () => {
    vi.stubEnv('WMS_FBS_EXPLICIT_REQUEST_ENABLED', 'true');
    const f = fixture(); Object.assign(f.tasks[0], { status: 'IN_PROGRESS', barcode: 'scanned' });
    await expect(f.service.getNextFbsTsdAssembly('TSD-1', user, 'request-balandin')).rejects.toThrow('другой FBS-заявке');
    expect(f.db.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
  });

  // TEST: an unconfigured/sold installation retains its previous queue behavior.
  it.each(['false', ''])('preserves legacy allocation when the flag is %s', async flag => {
    vi.stubEnv('WMS_FBS_EXPLICIT_REQUEST_ENABLED', flag);
    const f = fixture();
    expect((await f.service.getNextFbsTsdAssembly('TSD-1', user, '')).task.requestId).toBe('request-balandin');
    f.tasks[1].status = 'COMPLETED';
    expect((await f.service.getNextFbsTsdAssembly('TSD-1', user, '')).task.requestId).toBe('request-lukin');
  });
});
