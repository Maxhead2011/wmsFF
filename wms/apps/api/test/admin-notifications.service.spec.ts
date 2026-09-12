import { describe, expect, it, vi } from 'vitest';
import { AdminNotificationsService, type AdminEvent } from '../src/modules/admin-notifications/admin-notifications.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import type { AuthUser } from '../src/modules/auth/auth.types';

const admin: AuthUser = { id: 'admin', email: 'admin@example.test', name: 'Администратор', roleCodes: ['ADMIN'],
  permissionCodes: ['system:admin'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] };
const picker: AuthUser = { ...admin, id: 'picker', name: 'Сборщик', deviceCode: 'TSD-1' };
const event: AdminEvent = { type: 'PRODUCT_PROBLEM', dedupeKey: 'test:1', title: 'Проблема', body: 'Детали',
  clientId: 'client', warehouseId: 'warehouse', actorId: picker.id, actorName: picker.name };
function notifications(prisma: any, enabled = true) {
  return new AdminNotificationsService(prisma, { get: () => String(enabled) } as never);
}
function fixture(enabled = true) {
  const audit = { id: 'audit', boxId: 'box', clientId: 'client', boxCode: 'BOX-1', startedAt: new Date('2026-09-12'), status: 'COUNTING', lines: [] };
  const current = { id: 'session', type: 'BOX_CHECK', title: 'Проверка', clientId: 'client', warehouseId: null, status: 'ACTIVE', boxes: [audit] };
  const prisma: any = {
    inventorySession: { findUnique: vi.fn().mockResolvedValue(current), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(current) },
    box: { findUnique: vi.fn().mockResolvedValue({ id: 'box', code: 'BOX-1', clientId: 'client', warehouseId: null, status: 'active', client: { name: 'Клиент' } }) },
    inventoryAuditBox: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(audit) },
    inventoryBoxRescanRequest: { findFirst: vi.fn().mockResolvedValue(null) },
    stockBalance: { findMany: vi.fn().mockResolvedValue([]) },
    adminNotification: { upsert: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
  const scopes = { requireClientAccess: vi.fn(), requireGlobalClientAccess: vi.fn() };
  const service = new InventoryService(prisma, scopes as never, {} as never, undefined, notifications(prisma, enabled));
  return { prisma, scopes, service, audit, current };
}

// TEST: role checks run on every endpoint, including when the feature is disabled.
describe('admin operational notifications access and disabled mode', () => {
  it.each(['list', 'markRead', 'claimPopup'] as const)('rejects a non-admin on %s', async method => {
    const service = notifications({}, false);
    const user = { ...admin, roleCodes: ['MANAGER'] };
    await expect(method === 'list' ? service.list(user) : service[method](1, user)).rejects.toThrow('только администратору');
  });
  it('does not access new tables or open transactions when disabled', async () => {
    const service = notifications({}, false);
    expect(await service.list(admin)).toMatchObject({ enabled: false, items: [], unreadCount: 0 });
    await service.record({} as never, event);
    const build = vi.fn();
    expect(await service.withEvent(async () => 42, build)).toBe(42);
    expect(build).not.toHaveBeenCalled();
  });
  it('rolls event recording into the same transaction as the action', async () => {
    const tx = { adminNotification: { upsert: vi.fn().mockRejectedValue(new Error('database unavailable')) } };
    const prisma = { $transaction: vi.fn(async (fn: any) => fn(tx)) };
    const action = vi.fn(async () => 42);
    await expect(notifications(prisma).withEvent(action, () => event)).rejects.toThrow('database unavailable');
    expect(action).toHaveBeenCalledWith(tx);
  });
  it.each(['markRead', 'claimPopup'] as const)('rechecks visibility before %s', async method => {
    const prisma = { adminNotification: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(notifications(prisma)[method](77, admin)).rejects.toThrow('недоступно');
  });
});

// TEST: successful business actions produce the four required event kinds.
describe('inventory operational event sources', () => {
  const signal = { type: 'BOX_CHECK' as const, clientId: 'client', title: 'Нет короба BOX-1', comment: '[FBS_MISSING_PALLET_BOX] Короб BOX-1; паллета P-1' };
  it('records a missing box together with the created TSD task', async () => {
    const { prisma, service } = fixture();
    await service.startSession(signal, picker);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.adminNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ type: 'MISSING_PALLET_BOX', sessionId: 'session', actorId: 'picker' }) }));
  });
  it('reuses a task created by a simultaneous missing-box report', async () => {
    const { prisma, service, current } = fixture();
    prisma.inventorySession.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(current);
    await service.startSession(signal, picker);
    expect(prisma.inventorySession.create).not.toHaveBeenCalled();
    expect(prisma.adminNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { dedupeKey: 'missing:session' } }));
  });
  it('does not create another signal for an existing unresolved task', async () => {
    const { prisma, service, current } = fixture();
    prisma.inventorySession.findFirst.mockResolvedValue(current);
    await service.startSession(signal, picker);
    expect(prisma.adminNotification.upsert).not.toHaveBeenCalled();
  });
  it('records the first actual opening of a new box check', async () => {
    const { prisma, service } = fixture();
    await service.openBox('session', 'BOX-1', picker);
    expect(prisma.adminNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ type: 'BOX_CHECK_STARTED', sessionId: 'session', auditBoxId: 'audit' }) }));
  });
  it('does not turn a repeated open of a counting box into a new check', async () => {
    const { prisma, service, audit } = fixture();
    prisma.inventoryAuditBox.findUnique.mockResolvedValue(audit);
    await service.openBox('session', 'BOX-1', picker);
    expect(prisma.adminNotification.upsert).not.toHaveBeenCalled();
  });
  it('records explicit existing-check opening with an idempotency key', async () => {
    const { prisma, service } = fixture();
    await service.recordViewed('session', 'audit', 'click-uuid', picker);
    expect(prisma.adminNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ type: 'BOX_CHECK_OPENED', dedupeKey: 'view:session:audit:picker:click-uuid' }) }));
  });
  it('rejects a box that belongs to a different check', async () => {
    const { prisma, service } = fixture();
    await expect(service.recordViewed('session', 'foreign', 'click', picker)).rejects.toThrow('отсутствует');
    expect(prisma.adminNotification.upsert).not.toHaveBeenCalled();
  });
  it('does not generate notifications from background GET requests', async () => {
    const { prisma, service } = fixture();
    await service.getSession('session', picker);
    await service.getSession('session', picker);
    expect(prisma.adminNotification.upsert).not.toHaveBeenCalled();
  });
  it('rejects recording when client access was revoked', async () => {
    const { prisma, service, scopes } = fixture();
    scopes.requireClientAccess.mockImplementation(() => { throw new Error('forbidden'); });
    await expect(service.recordViewed('session', 'audit', 'click', picker)).rejects.toThrow('forbidden');
    expect(prisma.adminNotification.upsert).not.toHaveBeenCalled();
  });
  it('preserves missing-box and new-check behavior with the feature disabled', async () => {
    const { prisma, service } = fixture(false);
    await service.startSession(signal, picker);
    await service.openBox('session', 'BOX-1', picker);
    expect(await service.recordViewed('session', 'audit', 'click', picker)).toEqual({ recorded: false });
    expect(prisma.adminNotification.upsert).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('TSD product problem event', () => {
  function setup(enabled = true) {
    const task = { id: 'task', clientId: 'client', requestId: 'request', orderId: '12345', productName: 'Товар', article: 'ART',
      status: 'IN_PROGRESS', workerUserId: picker.id, deviceCode: picker.deviceCode, boxCode: 'BOX-1', startedAt: new Date('2026-09-12'), updatedAt: new Date('2026-09-12') };
    const prisma: any = { fbsTsdAssembly: { findUnique: vi.fn().mockResolvedValue(task), update: vi.fn().mockResolvedValue({}) },
      clientRequest: { findUnique: vi.fn().mockResolvedValue({ warehouseId: 'warehouse' }) },
      adminNotification: { upsert: vi.fn().mockResolvedValue({}) }, $transaction: vi.fn(async (fn: any) => fn(prisma)) };
    const service = new MarketplaceConnectionsService(prisma, { requireClientAccess: vi.fn() } as never,
      undefined, undefined, undefined, undefined, undefined, undefined, notifications(prisma, enabled));
    vi.spyOn(service as any, 'emptyFbsTsdAssembly').mockResolvedValue({});
    return { service, prisma, task };
  }
  it('keeps picker, box, product and order in the event after releasing the task', async () => {
    const { service, prisma } = setup();
    await service.releaseFbsTsdAssembly('task', picker);
    const created = prisma.adminNotification.upsert.mock.calls[0][0].create;
    expect(created).toMatchObject({ type: 'PRODUCT_PROBLEM', actorId: picker.id, requestId: 'request', warehouseId: 'warehouse' });
    expect(created.body).toContain('BOX-1'); expect(created.body).toContain('12345');
    expect(prisma.fbsTsdAssembly.update.mock.calls[0][0].data).toMatchObject({ workerUserId: null, boxCode: null });
  });
  it('creates no event when releasing the task fails', async () => {
    const { service, prisma } = setup();
    prisma.fbsTsdAssembly.update.mockRejectedValue(new Error('stale lease'));
    await expect(service.releaseFbsTsdAssembly('task', picker)).rejects.toThrow('stale lease');
    expect(prisma.adminNotification.upsert).not.toHaveBeenCalled();
  });
  it('creates no event for an already completed task', async () => {
    const { service, prisma, task } = setup(); task.status = 'COMPLETED';
    await expect(service.releaseFbsTsdAssembly('task', picker)).rejects.toThrow('нельзя отложить');
    expect(prisma.adminNotification.upsert).not.toHaveBeenCalled();
  });
  it('preserves the original update and performs no extra reads when disabled', async () => {
    const { service, prisma } = setup(false);
    await service.releaseFbsTsdAssembly('task', picker);
    expect(prisma.clientRequest.findUnique).not.toHaveBeenCalled();
    expect(prisma.adminNotification.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.fbsTsdAssembly.update.mock.calls[0][0].where).toEqual({ id: 'task' });
  });
});
