import { describe, it, expect, vi } from 'vitest';
import { TsdMonitorMessages } from '../src/modules/tsd/tsd-monitor-messages';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TsdDeviceService } from '../src/modules/tsd/tsd-device.service';
import { AdministrationController } from '../src/modules/administration/administration.controller';
import { TsdDeviceController } from '../src/modules/tsd/tsd-device.controller';

// TEST: a received heartbeat is not a read receipt; scope and retries are explicit.
const admin = { id: 'admin', name: 'Диспетчер', administrationEnabled: true, permissionCodes: ['system:admin'], roleCodes: ['ADMIN'] } as AuthUser;
const worker = { id: 'worker01-uuid', name: 'Шохида', deviceCode: 'TSD-INSTALL-ONE' } as AuthUser;
const code = 'TSD-INSTALL-ONE@WORKER01';
const heartbeat = { deviceId: code, payload: { workerUserId: worker.id, monitorMessages: true } };
const message = { id: 'm1', deviceId: code, operationType: 'monitor_message', reviewedAt: null, createdAt: new Date(), payload: { text: 'Подойдите к упаковке', issuedBy: admin.id, senderName: admin.name, recipientUserId: worker.id }, status: 'ACCEPTED' };
function setup() {
  const op = { findFirst: vi.fn().mockResolvedValue(heartbeat), findMany: vi.fn().mockResolvedValue([message]), findUnique: vi.fn().mockResolvedValue(message), upsert: vi.fn().mockResolvedValue(message), updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
  return { op, service: new TsdMonitorMessages({ tsdOperation: op } as never) };
}
describe('TSD messages', () => {
  it('sends to exact live device and employee, recording sender', async () => {
    const { op, service } = setup();
    await service.send(code, { text: 'Подойдите к упаковке', requestId: '12345678-1234-4123-8123-123456789012' }, admin);
    expect(op.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ deviceId: code, payload: expect.objectContaining({ recipientUserId: worker.id, issuedBy: admin.id }), reviewedAt: null }) }));
  });
  it.each(['', ' '.repeat(4), 'x'.repeat(2001), null, 42])('rejects invalid message %s', async (text) => {
    const { service, op } = setup();
    await expect(service.send(code, { text, requestId: 'bad' }, admin)).rejects.toThrow();
    expect(op.upsert).not.toHaveBeenCalled();
  });
  it.each([{ ...admin, administrationEnabled: false }, { ...admin, roleCodes: ['CLIENT'] }, { ...admin, permissionCodes: [] }, { ...admin, isDemo: true }])('denies non-dispatcher access', async (user) => {
    const { service, op } = setup();
    await expect(service.list(code, user)).rejects.toThrow();
    expect(op.findMany).not.toHaveBeenCalled();
  });
  it('rejects missing or old terminal with clear update instruction', async () => {
    const { service, op } = setup();
    op.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...heartbeat, payload: { workerUserId: worker.id } });
    await expect(service.send(code, { text: 'Тест', requestId: '12345678-1234-4123-8123-123456789012' }, admin)).rejects.toThrow('ТСД');
    await expect(service.send(code, { text: 'Тест', requestId: '12345678-1234-4123-8123-123456789012' }, admin)).rejects.toThrow('Обновите');
  });
  it('returns oldest pending message without acknowledging it', async () => {
    const { service, op } = setup(); op.findFirst.mockResolvedValue(message);
    expect(await service.next(code, worker)).toMatchObject({ id: 'm1', text: message.payload.text });
    expect(op.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deviceId: code, reviewedAt: null, payload: { path: ['recipientUserId'], equals: worker.id } }), orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }));
    expect(op.updateMany).not.toHaveBeenCalled();
  });
  it('ignores spoofed installation and handles empty queue', async () => {
    const { service, op } = setup();
    expect(await service.next('OTHER', worker)).toBeNull();
    expect(op.findFirst).not.toHaveBeenCalled();
    op.findFirst.mockResolvedValue(null);
    expect(await service.next(code, worker)).toBeNull();
  });
  it('acknowledges only by authenticated recipient, atomically and idempotently', async () => {
    const { service, op } = setup();
    await service.ack('m1', worker);
    expect(op.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1', reviewedAt: null }, data: expect.objectContaining({ reviewedByUserId: worker.id, reviewedAt: expect.any(Date) }) }));
    op.findUnique.mockResolvedValue({ ...message, reviewedAt: new Date() });
    await service.ack('m1', worker);
    expect(op.updateMany).toHaveBeenCalledTimes(1);
  });
  it.each([null, { ...message, deviceId: 'OTHER' }, { ...message, operationType: 'monitor_command' }, { ...message, payload: { ...message.payload, recipientUserId: 'other' } }])('rejects foreign ack', async (row) => {
    const { service, op } = setup(); op.findUnique.mockResolvedValue(row);
    await expect(service.ack('m1', worker)).rejects.toThrow();
    expect(op.updateMany).not.toHaveBeenCalled();
  });
  it('limits history, exposes explicit read time', async () => {
    const { service, op } = setup();
    op.findMany.mockResolvedValue([{ ...message, reviewedAt: new Date('2026-09-08T10:00:00Z') }]);
    expect((await service.list(code, admin)).messages[0].readAt).toBe('2026-09-08T10:00:00.000Z');
    expect(op.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });
  it('rejects changed content with reused request ID', async () => {
    const { service } = setup();
    await expect(service.send(code, { text: 'Другой текст', requestId: '12345678-1234-4123-8123-123456789012' }, admin)).rejects.toThrow('уже выполнена');
  });
  it('uses the same unique operation key and empty update for a retry', async () => {
    const { service, op } = setup();
    const body = { text: message.payload.text, requestId: '12345678-1234-4123-8123-123456789012' };
    await service.send(code, body, admin); await service.send(code, body, admin);
    expect(op.upsert.mock.calls[0][0].where).toEqual(op.upsert.mock.calls[1][0].where);
    expect(op.upsert.mock.calls[1][0].update).toEqual({});
  });
  it.each(['', 'x'.repeat(201)])('rejects invalid device code', async code => {
    const { service } = setup(); await expect(service.list(code, admin)).rejects.toThrow('ТСД');
  });
  it('rejects invalid request ID and unidentified employee', async () => {
    const { service, op } = setup();
    await expect(service.send(code, { text: 'Тест', requestId: 'wrong' }, admin)).rejects.toThrow('идентификатор');
    op.findFirst.mockResolvedValue({ ...heartbeat, payload: { monitorMessages: true } });
    await expect(service.send(code, { text: 'Тест', requestId: '12345678-1234-4123-8123-123456789012' }, admin)).rejects.toThrow('сотрудник');
  });
  it('does not poll messages with a web-only token', async () => {
    const { service, op } = setup();
    expect(await service.next(code, { ...worker, deviceCode: undefined })).toBeNull();
    expect(op.findFirst).not.toHaveBeenCalled();
  });
  it('wires heartbeat delivery without changing old commands or auto-reading', async () => {
    const { op } = setup();
    op.findFirst.mockImplementation(async query => query.where.operationType === 'monitor_message' ? message : null);
    const service = new TsdDeviceService({ tsdOperation: op } as never, {} as never, {} as never, {} as never);
    const result = await service.recordMonitorHeartbeat({ deviceCode: worker.deviceCode, monitorMessages: true }, worker);
    expect(result.message).toMatchObject({ id: 'm1', readAt: null });
    expect(result.command).toBeNull();
    expect(op.updateMany).not.toHaveBeenCalled();
    const old = await service.recordMonitorHeartbeat({ deviceCode: worker.deviceCode }, worker);
    expect(old.message).toBeNull();
    expect(op.findFirst.mock.calls.filter(([query]) => query.where.operationType === 'monitor_message')).toHaveLength(1);
  });
  it('requires staff/device permissions on HTTP handlers', () => {
    expect(Reflect.getMetadata('requiredPermissions', AdministrationController.prototype.sendTsdMessage)).toEqual(['system:admin']);
    expect(Reflect.getMetadata('requiredPermissions', AdministrationController.prototype.tsdMessages)).toEqual(['system:admin']);
    expect(Reflect.getMetadata('requiredPermissions', TsdDeviceController.prototype.acknowledgeMonitorMessage)).toEqual(['stock:write']);
  });
});
