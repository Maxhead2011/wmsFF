import 'reflect-metadata';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { claimReleasedFbsKiz } from '../src/modules/marketplace-connections/fbs-released-kiz-claim';
const url = process.env.FBO_TEST_DATABASE_URL;
if (url && !/^postgresql:\/\/codex_tests@127\.0\.0\.1:55485\/kiz_duplicate_tests(?:\?|$)/.test(url)) throw Error('Isolated DB only');
describe.skipIf(!url).sequential('released FBS KIZ live ownership', () => {
  const p = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  let client: string, uid: string, sku: string, box: string, old: any, task: any, kiz: string;
  beforeEach(async () => {
    [client, uid, sku, box] = Array.from({ length: 4 }, () => randomUUID()); kiz = '010464056995953921' + randomUUID();
    await p.client.create({ data: { id: client, code: client, name: 'KIZ regression' } });
    await p.user.create({ data: { id: uid, email: uid + '@invalid', name: 'Tester', passwordHash: 'test' } });
    await p.sku.create({ data: { id: sku, clientId: client, internalSku: sku, name: 'Suit' } });
    await p.box.create({ data: { id: box, code: box, clientId: client } });
    await p.productMark.create({ data: { clientId: client, skuId: sku, boxId: box, value: kiz, status: 'AVAILABLE' } });
    const data = { clientId: client, connectionId: client, requestId: client, requestItemId: sku, skuId: sku, productName: 'Suit', barcodes: [], storageBoxes: [], deviceCode: 'test', workerUserId: uid, boxId: box, boxCode: box };
    old = await p.fbsTsdAssembly.create({ data: { ...data, orderId: 'old', status: 'RELEASED', kiz, wbMetaStatus: 'REJECTED' } });
    task = await p.fbsTsdAssembly.create({ data: { ...data, orderId: 'new', status: 'IN_PROGRESS', wbMetaStatus: 'PENDING' } });
  });
  afterEach(async () => {
    await p.auditLog.deleteMany({ where: { userId: uid } });
    await p.fbsTsdAssembly.deleteMany({ where: { clientId: client } });
    await p.productMark.deleteMany({ where: { clientId: client } });
    await p.box.deleteMany({ where: { clientId: client } });
    await p.sku.deleteMany({ where: { clientId: client } });
    await p.client.delete({ where: { id: client } }); await p.user.delete({ where: { id: uid } });
  });
  afterAll(() => p.$disconnect());
  const claim = () => p.$transaction(tx => claimReleasedFbsKiz(tx, task, kiz, uid));
  it('claims the freed unique slot and preserves history once on retry', async () => {
    // TEST: before the fix this final write fails with PostgreSQL unique(clientId,kiz).
    task = await claim();
    await p.fbsTsdAssembly.update({ where: { id: task.id }, data: { kiz } });
    await claim();
    expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: old.id } })).kiz).toBeNull();
    const audit = await p.auditLog.findMany({ where: { userId: uid } });
    expect(audit).toHaveLength(1); expect(audit[0].payload).toMatchObject({ kiz, previousOrderId: 'old', orderId: 'new' });
    expect((await p.productMark.findFirstOrThrow({ where: { clientId: client } })).status).toBe('AVAILABLE');
  });
  it.each(['IN_PROGRESS', 'COMPLETED', 'RETURN_REQUIRED'])('keeps %s ownership', async status => {
    // TEST: no active/completed task may be silently displaced.
    await p.fbsTsdAssembly.update({ where: { id: old.id }, data: { status } });
    await expect(claim()).rejects.toThrow();
    expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: old.id } })).kiz).toBe(kiz);
  });
  it('rolls back release and audit when the new lease changed', async () => {
    // TEST: the legacy unique slot must survive a concurrent reassignment.
    await p.fbsTsdAssembly.update({ where: { id: task.id }, data: { deviceCode: 'other' } });
    await expect(claim()).rejects.toThrow();
    expect((await p.fbsTsdAssembly.findUniqueOrThrow({ where: { id: old.id } })).kiz).toBe(kiz);
    expect(await p.auditLog.count({ where: { userId: uid } })).toBe(0);
  });
  it('keeps a released task if WB accepted its KIZ', async () => {
    // TEST: RELEASED alone is insufficient evidence for reusing a mark.
    await p.fbsTsdAssembly.update({ where: { id: old.id }, data: { wbMetaStatus: 'ACCEPTED' } });
    await expect(claim()).rejects.toThrow();
  });
});
