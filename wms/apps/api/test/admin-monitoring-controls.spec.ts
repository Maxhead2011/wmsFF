import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AdministrationService } from '../src/modules/administration/administration.service';
import { TsdMonitorMessages } from '../src/modules/tsd/tsd-monitor-messages';

afterEach(() => vi.unstubAllEnvs());
const admin = { id: 'admin', name: 'Администратор', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], administrationEnabled: false, isDemo: false };
const body = { text: 'Проверьте задание', requestId: '12345678-1234-4123-8123-123456789012' };
function setup() {
  const task = { id: 'task', requestId: 'request', orderId: 'order', status: 'IN_PROGRESS', updatedAt: new Date(), deviceCode: 'TSD-1' };
  const prisma = {
    tsdDevice: { findFirst: vi.fn().mockResolvedValue({ id: 'device', code: 'TSD-1', userId: 'worker', user: { name: 'Сотрудник' } }) },
    tsdOperation: {
      findFirst: vi.fn().mockResolvedValue({ deviceId: 'TSD-1', payload: { screen: 'INVENTORY_COUNT', inventorySessionId: 'inventory', appVersion: '0.1.120', workerUserId: 'worker', monitorMessages: true } }),
      create: vi.fn().mockResolvedValue({ id: 'command' }),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({ id: 'message', deviceId: 'TSD-1', payload: { text: body.text, recipientUserId: 'worker' }, createdAt: new Date(), reviewedAt: null }),
    },
    inventorySession: {
      findFirst: vi.fn().mockResolvedValue({ id: 'inventory', type: 'BOX_CHECK', title: 'Проверка', boxes: [] }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([task]), count: vi.fn().mockResolvedValue(0), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    clientRequest: { count: vi.fn().mockResolvedValue(1), findFirst: vi.fn().mockResolvedValue({ id: 'request', number: 957, clientId: 'client' }) },
    clientRequestEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (work: any) => typeof work === 'function' ? work(prisma) : Promise.all(work)),
  };
  const audit = { write: vi.fn().mockResolvedValue(undefined) };
  return { prisma, audit, service: new AdministrationService(prisma as never, {} as never, {} as never, audit as never, {} as never, {} as never, {} as never), messages: new TsdMonitorMessages(prisma as never) };
}

// TEST: ADMIN must execute the same guarded monitoring operations as owner, without promotion.
describe('ADMIN monitoring controls', () => {
  it('disconnects tasks, releases FBS work and records the administrator', async () => {
    vi.stubEnv('ADMIN_MONITORING_ENABLED', 'true');
    const { service, prisma, audit } = setup();
    await expect(service.disconnectTsdRequest({ requestId: 'request', deviceCode: 'TSD-1' }, admin as never)).resolves.toMatchObject({ releasedOrders: 1 });
    expect(prisma.fbsTsdAssembly.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'task', status: 'IN_PROGRESS' }), data: expect.objectContaining({ status: 'RELEASED', workerUserId: null }) }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ userId: admin.id, action: 'administration.tsd-request.disconnect' }));
    await expect(service.releaseTsdWorkload({ kind: 'FBS_ORDER', workloadId: 'task' }, admin as never)).resolves.toMatchObject({ released: 1 });
  });
  it('unlocks only the selected employee inventory and records command issuer', async () => {
    vi.stubEnv('ADMIN_MONITORING_ENABLED', 'true');
    const { service, prisma } = setup();
    await expect(service.issueTsdMonitorAction('TSD-1', 'UNLOCK_INVENTORY', admin as never)).resolves.toMatchObject({ accepted: true });
    expect(prisma.inventorySession.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'inventory', status: 'ACTIVE', OR: [{ createdByUserId: 'worker' }, { boxes: { some: { countedByUserId: 'worker' } } }] } }));
    expect(prisma.inventorySession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED', completedByUserId: admin.id }) }));
    expect(prisma.tsdOperation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ action: 'UNLOCK_INVENTORY', issuedBy: admin.id }) }) }));
  });
  // TEST: administrator access must not bypass accepted KIZ or confirmed relabel protection.
  it.each([{ kiz: 'accepted-kiz' }, { wbMetaStatus: 'ACCEPTED' }, { relabelConfirmedAt: new Date() }])('keeps protected tasks intact: %j', async protection => {
    vi.stubEnv('ADMIN_MONITORING_ENABLED', 'true');
    const { service, prisma } = setup();
    const task = (await prisma.fbsTsdAssembly.findMany())[0];
    prisma.fbsTsdAssembly.findMany.mockResolvedValue([{ ...task, ...protection }]);
    await expect(service.disconnectTsdRequest({ requestId: 'request', deviceCode: 'TSD-1' }, admin as never)).rejects.toThrow('защищены заказы');
    await expect(service.releaseTsdWorkload({ kind: 'FBS_ORDER', workloadId: 'task' }, admin as never)).rejects.toThrow('Заказ order');
    expect(prisma.fbsTsdAssembly.updateMany).not.toHaveBeenCalled();
    expect(prisma.tsdOperation.create).not.toHaveBeenCalled();
  });
  it('sends to the authenticated device employee and reads message history', async () => {
    vi.stubEnv('ADMIN_MONITORING_ENABLED', 'true');
    const { messages, prisma } = setup();
    await messages.send('TSD-1', body, admin as never);
    await expect(messages.list('TSD-1', admin as never)).resolves.toMatchObject({ messages: [] });
    expect(prisma.tsdOperation.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ payload: expect.objectContaining({ issuedBy: admin.id, recipientUserId: 'worker' }) }) }));
  });
  it.each([undefined, 'false'])('keeps sold installation controls unchanged with flag %s', async flag => {
    vi.stubEnv('ADMIN_MONITORING_ENABLED', flag);
    await denied(admin);
  });
  it.each([{ roleCodes: ['MANAGER'] }, { roleCodes: ['ADMIN', 'CLIENT'] }, { permissionCodes: [] }, { isDemo: true }])('rejects ineligible user %j before data access', async override => {
    vi.stubEnv('ADMIN_MONITORING_ENABLED', 'true');
    await denied({ ...admin, ...override });
  });
  it.each(['LOGOUT', 'UPDATE_APP', 'RELOAD_REQUEST'])('keeps %s and general administration owner-only', async action => {
    vi.stubEnv('ADMIN_MONITORING_ENABLED', 'true');
    const { service, prisma } = setup();
    await expect(service.issueTsdMonitorAction('TSD-1', action, admin as never)).rejects.toThrow(ForbiddenException);
    expect(() => service.documentation(admin as never)).toThrow(ForbiddenException);
    expect(prisma.tsdDevice.findFirst).not.toHaveBeenCalled();
  });
});

async function denied(user: typeof admin) {
  const { service, messages, prisma } = setup();
  await expect(service.issueTsdMonitorAction('TSD-1', 'UNLOCK_INVENTORY', user as never)).rejects.toThrow(ForbiddenException);
  await expect(service.disconnectTsdRequest({ requestId: 'request', deviceCode: 'TSD-1' }, user as never)).rejects.toThrow(ForbiddenException);
  await expect(service.releaseTsdWorkload({ kind: 'FBS_ORDER', workloadId: 'task' }, user as never)).rejects.toThrow(ForbiddenException);
  await expect(messages.send('TSD-1', body, user as never)).rejects.toThrow(ForbiddenException);
  await expect(messages.list('TSD-1', user as never)).rejects.toThrow(ForbiddenException);
  expect(prisma.tsdDevice.findFirst).not.toHaveBeenCalled();
  expect(prisma.tsdOperation.findFirst).not.toHaveBeenCalled();
}
