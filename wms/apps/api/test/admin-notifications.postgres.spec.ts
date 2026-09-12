import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AdminNotificationsService, type AdminEvent } from '../src/modules/admin-notifications/admin-notifications.service';
import type { AuthUser } from '../src/modules/auth/auth.types';

const databaseUrl = process.env.ADMIN_NOTIFICATIONS_TEST_DATABASE_URL;
const admin: AuthUser = { id: 'admin-a', name: 'Admin A', email: 'a@example.test', roleCodes: ['ADMIN'],
  permissionCodes: ['system:admin'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] };
const otherAdmin: AuthUser = { ...admin, id: 'admin-b' };
const event: AdminEvent = { type: 'MISSING_PALLET_BOX', dedupeKey: 'missing:1', title: 'Короба нет', body: 'Сборщик · BOX-1 · P-1',
  actorId: 'picker', actorName: 'Сборщик', clientId: 'client-a', warehouseId: 'warehouse-a' };

// TEST: real PostgreSQL verifies transactions, races, access filters and per-admin receipt persistence.
// Uses only a dedicated local test database. Apply the additive notification migration first.
describe.skipIf(!databaseUrl)('admin notifications PostgreSQL integration', () => {
  let prisma: PrismaClient;
  let service: AdminNotificationsService;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55432' || !/^\/wms_admin_notifications_test_[a-z0-9_]+$/.test(url.pathname)) {
      throw new Error('Use a dedicated local wms_admin_notifications_test_* database on port 55432.');
    }
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    service = new AdminNotificationsService(prisma as never, { get: () => 'true' } as never);
    await prisma.$connect();
  });
  beforeEach(async () => { await prisma.adminNotification.deleteMany(); });
  afterAll(async () => { if (prisma) { await prisma.adminNotification.deleteMany(); await prisma.$disconnect(); } });
  async function create(overrides: Partial<AdminEvent> = {}) {
    const data = { ...event, ...overrides };
    await service.record(prisma, data);
    return (await prisma.adminNotification.findUniqueOrThrow({ where: { dedupeKey: data.dedupeKey } })).id;
  }
  it('deduplicates simultaneous event deliveries', async () => {
    await Promise.all(Array.from({ length: 8 }, () => service.record(prisma, event)));
    expect(await prisma.adminNotification.count()).toBe(1);
  });
  it('allows only one popup claim for simultaneous tabs of an admin', async () => {
    const id = await create();
    const results = await Promise.all(Array.from({ length: 8 }, () => service.claimPopup(id, admin)));
    expect(results.filter(value => value.claimed)).toHaveLength(1);
    expect(await service.claimPopup(id, otherAdmin)).toEqual({ claimed: true });
  });
  it('keeps popup dismissal unread and stores history across reloads', async () => {
    const id = await create(); await service.claimPopup(id, admin);
    const reloaded = new AdminNotificationsService(prisma as never, { get: () => 'true' } as never);
    expect(await reloaded.list(admin)).toMatchObject({ unreadCount: 1, popupCandidates: [], items: [{ id, isRead: false }] });
  });
  it('marks read separately for each administrator and prevents a later popup', async () => {
    const id = await create(); await service.markRead(id, admin);
    expect(await service.claimPopup(id, admin)).toEqual({ claimed: false });
    expect(await service.list(admin)).toMatchObject({ unreadCount: 0, items: [{ isRead: true }] });
    expect(await service.list(otherAdmin)).toMatchObject({ unreadCount: 1, items: [{ isRead: false }] });
  });
  it('enforces role restrictions on feed and mutation endpoints', async () => {
    const id = await create(); const user = { ...admin, roleCodes: ['MANAGER'] };
    await expect(service.list(user)).rejects.toThrow('только администратору');
    await expect(service.claimPopup(id, user)).rejects.toThrow('только администратору');
    await expect(service.markRead(id, user)).rejects.toThrow('только администратору');
    expect(await prisma.adminNotificationReceipt.count()).toBe(0);
  });
  it('filters client, warehouse and demo scope before counting or offering popups', async () => {
    const allowed = await create();
    await create({ dedupeKey: 'client-b', clientId: 'client-b' });
    await create({ dedupeKey: 'warehouse-b', warehouseId: 'warehouse-b' });
    await create({ dedupeKey: 'demo', isDemo: true });
    const user = { ...admin, clientScopeMode: 'LIMITED' as const, clientIds: ['client-a'], warehouseIds: ['warehouse-a'] };
    const feed = await service.list(user);
    expect(feed.unreadCount).toBe(1); expect(feed.items.map(row => row.id)).toEqual([allowed]);
    expect(feed.popupCandidates.map(row => row.id)).toEqual([allowed]);
  });
  it('hides excluded clients even from an administrator', async () => {
    const id = await create(); const user = { ...admin, hiddenClientIds: ['client-a'] };
    expect((await service.list(user)).items).toHaveLength(0);
    await expect(service.markRead(id, user)).rejects.toThrow('недоступно');
    await expect(service.claimPopup(id, user)).rejects.toThrow('недоступно');
  });
  it('rejects a warehouse-scoped administrator without an assigned warehouse', async () => {
    await create();
    expect((await service.list({ ...admin, permissionCodes: ['stock:read'], warehouseIds: [] })).items).toHaveLength(0);
  });
  it('does not lose offline events beyond the first history page', async () => {
    await prisma.adminNotification.createMany({ data: Array.from({ length: 56 }, (_, i) => ({ ...event, dedupeKey: `offline:${i}` })) });
    const first = await service.list(admin);
    expect(first.items).toHaveLength(50); expect(first.unreadCount).toBe(56); expect(first.popupCandidates).toHaveLength(3);
    const older = await service.list(admin, first.nextBeforeId!);
    expect(older.items).toHaveLength(6); expect(older.popupCandidates).toHaveLength(0);
    expect(new Set([...first.items, ...older.items].map(row => row.id)).size).toBe(56);
    expect(first.popupCandidates[0].id).toBe(older.items.at(-1)?.id);
  });
  it('rolls back the business write when recording its event fails', async () => {
    await expect(service.withEvent(async tx => {
      await tx.adminNotification.create({ data: { ...event, dedupeKey: 'business-write' } });
      return 42;
    }, () => { throw new Error('event failure'); })).rejects.toThrow('event failure');
    expect(await prisma.adminNotification.count()).toBe(0);
  });
});
