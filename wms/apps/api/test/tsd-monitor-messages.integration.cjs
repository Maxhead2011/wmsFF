// TEST: compiled service lifecycle with a stateful isolated journal (no production DB).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TsdMonitorMessages } = require('../dist/modules/tsd/tsd-monitor-messages.js');
const admin = { id: 'admin', name: 'Диспетчер', administrationEnabled: true, permissionCodes: ['system:admin'], roleCodes: ['ADMIN'] };
const user = { id: 'worker01', deviceCode: 'TSD-INSTALL-ONE' };
const code = 'TSD-INSTALL-ONE@WORKER01';
const body = { text: 'Сообщение', requestId: '12345678-1234-4123-8123-123456789012' };
function setup() {
  const rows = [];
  const heartbeat = { deviceId: code, payload: { monitorMessages: true, workerUserId: user.id } };
  const prisma = { tsdOperation: {
    async findFirst({ where }) { return where.operationType === 'monitor_heartbeat' ? heartbeat : rows.find(row => !row.reviewedAt && row.deviceId === where.deviceId && row.payload.recipientUserId === where.payload.equals); },
    async findUnique({ where }) { return rows.find(row => row.id === where.id); },
    async findMany() { return rows; },
    async upsert({ where, create }) { let row = rows.find(row => row.operationKey === where.operationKey); if (!row) { row = { ...create, id: 'm1', createdAt: new Date() }; rows.push(row); } return row; },
    async updateMany({ where, data }) { const row = rows.find(row => row.id === where.id && row.reviewedAt === null); if (row) Object.assign(row, data); return { count: row ? 1 : 0 }; },
  } };
  return { service: new TsdMonitorMessages(prisma), rows, heartbeat, prisma };
}
test('send → repeated poll → explicit OK → no repeat; server restart retains unread journal', async () => {
  const { service, rows, prisma } = setup();
  const sent = await service.send(code, body, admin);
  assert.equal((await service.send(code, body, admin)).id, sent.id);
  assert.equal(rows.length, 1);
  assert.equal((await service.next(code, user)).readAt, null);
  assert.equal((await new TsdMonitorMessages(prisma).next(code, user)).id, sent.id);
  assert.equal((await service.list(code, admin)).messages[0].readAt, null);
  await assert.rejects(service.ack(sent.id, { ...user, id: 'another' }));
  await assert.rejects(service.ack(sent.id, { ...user, deviceCode: 'another' }));
  await service.ack(sent.id, user);
  const time = rows[0].reviewedAt;
  await service.ack(sent.id, user);
  assert.equal(rows[0].reviewedAt, time);
  assert.equal(await service.next(code, user), null);
  assert.ok((await service.list(code, admin)).messages[0].readAt);
});
test('access, validation and old-client failures never write stock or a message', async () => {
  const { service, rows, heartbeat, prisma } = setup();
  for (const changed of [{ administrationEnabled: false }, { permissionCodes: [] }, { isDemo: true }, { roleCodes: ['CLIENT'] }]) await assert.rejects(service.list(code, { ...admin, ...changed }));
  for (const text of ['', ' ', null, 'x'.repeat(2001)]) await assert.rejects(service.send(code, { ...body, text }, admin));
  await assert.rejects(service.send(code, { ...body, requestId: 'bad' }, admin));
  await assert.rejects(service.list('', admin));
  await assert.rejects(service.list('x'.repeat(201), admin));
  assert.equal(await service.next('OTHER', user), null);
  assert.equal(await service.next(code, { ...user, deviceCode: undefined }), null);
  await assert.rejects(service.ack('missing', user));
  heartbeat.payload.monitorMessages = false;
  await assert.rejects(service.send(code, body, admin));
  heartbeat.payload = { monitorMessages: true };
  await assert.rejects(service.send(code, body, admin));
  prisma.tsdOperation.findFirst = async () => null;
  await assert.rejects(service.list(code, admin));
  assert.equal(rows.length, 0);
});
test('conflicting UUID is rejected and alternate legacy device format is scoped', async () => {
  const { service, rows, heartbeat } = setup();
  await service.send(code, body, admin);
  await assert.rejects(service.send(code, { ...body, text: 'Изменено' }, admin));
  rows[0].operationType = 'monitor_command';
  await assert.rejects(service.ack('m1', user));
  rows[0].operationType = 'monitor_message';
  rows[0].deviceId = 'FFU-TSD-ONE';
  assert.ok(await service.next('FFU-TSD-ONE', { ...user, deviceCode: 'FFU-TSD-ONE' }));
  heartbeat.payload = null;
  assert.equal((await service.list(code, admin)).supported, false);
});
