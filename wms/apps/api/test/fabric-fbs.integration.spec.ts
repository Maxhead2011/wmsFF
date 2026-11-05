import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { reserveFabricOrder, fabricOrderKey } from '../src/modules/warehouse/fabric-fbs-order';
// TEST: exercise the actual release artifact with the same PostgreSQL scenarios.
const load=createRequire(import.meta.url), runtime=process.env.FABRIC_FBS_RUNTIME;
const {scanWbFabric}=runtime?load(runtime+'/fabric-fbs-scan.js'):await import('../src/modules/warehouse/fabric-fbs-scan');
const {confirmFabricProduction}=runtime?load(runtime+'/fabric-fbs-confirmation.js'):await import('../src/modules/warehouse/fabric-fbs-confirmation');
const {writeFabricProduction}=runtime?load(runtime+'/fabric-fbs-production.js'):await import('../src/modules/warehouse/fabric-fbs-production');
const {assignFabricOrder}=runtime?load(runtime+'/fabric-fbs-assignment.js'):await import('../src/modules/warehouse/fabric-fbs-assignment');
const {releaseCancelledFabricRequest}=runtime?load(runtime+'/fabric-fbs-task-release.js'):await import('../src/modules/warehouse/fabric-fbs-task-release');

const url = process.env.FABRIC_FBS_TEST_DATABASE_URL;
// TEST: never run fixture writes against a remote or ordinary application DB.
if (url) {
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_tests')) {
    throw new Error('Fabric integration requires a dedicated local *_tests database');
  }
}
const db = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
describe.skipIf(!db)('fabric production PostgreSQL transaction', () => {
  afterEach(()=>vi.unstubAllEnvs());
  const clients: string[] = [], users: string[] = [], warehouses: string[] = [];
  afterAll(async () => {
    if (!db) return;
    for (const clientId of clients) {
      await db.clientRequestEvent.deleteMany({ where: { clientId } });
      await db.auditLog.deleteMany({ where: { entityId: clientId } });
      await db.stockMovement.deleteMany({ where: { clientId } });
      await db.stockBalance.deleteMany({ where: { clientId } });
      await db.fbsTsdAssembly.deleteMany({ where: { clientId } });
      await db.clientRequest.deleteMany({ where: { clientId } });
      await db.systemSetting.deleteMany({ where: { key: { in: [`fabric.rolls.v1:${clientId}`, `fabric.rolls.enabled.v1:${clientId}`, `fabric.fbs.enabled.v1:${clientId}`] } } });
      await db.sku.deleteMany({ where: { clientId } });
      await db.client.delete({ where: { id: clientId } });
    }
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.warehouse.deleteMany({ where: { id: { in: warehouses } } });
    await db.$disconnect();
  });
  async function fixture() {
    const suffix = randomUUID();
    const client = await db!.client.create({ data: { code: suffix, name: 'Fabric transaction test' } });
    clients.push(client.id);
    const user = await db!.user.create({ data: { email: `${suffix}@example.invalid`, name: 'Test', passwordHash: 'not-login' } });
    users.push(user.id);
    const warehouse = await db!.warehouse.create({ data: { code: suffix, name: 'Fabric test warehouse' } });
    warehouses.push(warehouse.id);
    const sku = await db!.sku.create({ data: { clientId: client.id, internalSku: 'white_3', name: 'Ткань' } });
    const request = await db!.clientRequest.create({ data: { clientId: client.id, warehouseId: warehouse.id, type: 'OUTBOUND', title: suffix } });
    const item = await db!.clientRequestItem.create({ data: { requestId: request.id, skuId: sku.id, quantity: 2 } });
    const owner = { marketplace: 'OZON', connectionId: suffix, orderId: suffix, requestId: request.id };
    const task = await db!.fbsTsdAssembly.create({ data: { ...owner, marketplace: 'OZON', clientId: client.id,
      requestItemId: item.id, skuId: sku.id, productName: 'Ткань', barcodes: [], storageBoxes: [],
      itemCount: 2, deviceCode: suffix, workerUserId: user.id, status: 'IN_PROGRESS' } });
    const state = reserveFabricOrder({ rolls: [{ id: suffix, warehouseId: warehouse.id, material: 'SATIN', color: 'white',
      remainingMm: 100000, cutMm: 0, createdAt: '2026-11-05' }] }, owner,
      [{ lineId: item.id, skuId: sku.id, warehouseId: warehouse.id, material: 'SATIN', color: 'white', lengthMm: 3000, units: 2 }]);
    await db!.systemSetting.create({ data: { key: `fabric.rolls.v1:${client.id}`, value: state as unknown as Prisma.InputJsonValue } });
    const command = { owner, clientId: client.id, taskId: task.id, lineId: item.id, confirmedUnits: 2, operationId: suffix };
    const actor = { userId: user.id, deviceCode: suffix };
    const confirm = (fail = false) => db!.$transaction(tx => confirmFabricProduction(tx, command, actor, async (_, proof) => {
      await writeFabricProduction(tx, proof);
      if (fail) throw new Error('Injected failure after production');
    }));
    const snapshot = async () => ({
      state: (await db!.systemSetting.findUniqueOrThrow({ where: { key: `fabric.rolls.v1:${client.id}` } })).value as any,
      movements: await db!.stockMovement.findMany({ where: { clientId: client.id } }),
      balances: await db!.stockBalance.findMany({ where: { clientId: client.id } }),
      audits: await db!.auditLog.count({ where: { entityId: client.id } }),
      events: await db!.clientRequestEvent.count({ where: { clientId: client.id } }),
    });
    return { confirm, snapshot, client, request, owner, item, sku, warehouse, state, task, user };
  }
  // TEST: accepted scanner input is the only production trigger, atomically with its counter.
  it('cancellation and reserve release commit or roll back together',async()=>{
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED','true');
    const f=await fixture();
    await db!.fbsTsdAssembly.update({where:{id:f.task.id},data:{sourceArticle:'__FABRIC_FBS__'}});
    const cancel=(fail:boolean)=>db!.$transaction(async tx=>{
      await releaseCancelledFabricRequest(tx,f.request.id);
      await tx.clientRequest.update({where:{id:f.request.id},data:{status:'CANCELLED'}});
      if(fail)throw Error('Cancellation failure');
    });
    await expect(cancel(true)).rejects.toThrow('Cancellation failure');
    expect((await f.snapshot()).state.fbsReservations[0].released).toBe(false);
    expect((await db!.clientRequest.findUniqueOrThrow({where:{id:f.request.id}})).status).not.toBe('CANCELLED');
    await cancel(false);
    const state=await f.snapshot();
    expect(state.state.fbsReservations[0].released).toBe(true);
    expect(state.state.rolls[0].remainingMm).toBe(100000);
    expect(state.movements).toHaveLength(0);
  });
  it('WB scans one piece, retries without debit and rejects a wrong barcode',async()=>{
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED','true');
    const f=await fixture();
    const task=await db!.fbsTsdAssembly.update({where:{id:f.task.id},data:{sourceArticle:'__FABRIC_FBS__',marketplace:'WILDBERRIES',barcodes:['1234567890123']}});
    const ledger=reserveFabricOrder({rolls:f.state.rolls},task,f.state.fbsOrders![fabricOrderKey(f.owner)].lines);
    await db!.systemSetting.update({where:{key:`fabric.rolls.v1:${f.client.id}`},data:{value:ledger as any}});
    const service={prisma:db,requireCurrentFbsTsdLease:(fresh:any,user:any)=>{if(fresh.workerUserId!==user.id)throw Error('lease');},fbsTsdDeviceCode:()=>task.deviceCode};
    await expect(scanWbFabric(service,task,'999',0,f.user)).rejects.toThrow('Неверный');
    expect((await f.snapshot()).movements).toHaveLength(0);
    const first=await scanWbFabric(service,task,'1234567890123',0,f.user);
    expect(first.barcode).toBeNull();expect((await f.snapshot()).state.rolls[0].remainingMm).toBe(97000);
    await scanWbFabric(service,task,'1234567890123',0,f.user);
    expect((await f.snapshot()).movements).toHaveLength(1);
    const second=await scanWbFabric(service,task,'1234567890123',1,f.user);
    expect(second.barcode).toBe('1234567890123');expect((await f.snapshot()).state.rolls[0].remainingMm).toBe(94000);
    await scanWbFabric(service,task,'1234567890123',1,f.user);
    expect((await f.snapshot()).movements).toHaveLength(2);
  });
  // TEST: a failure persisting the accepted scan rolls back the material debit too.
  it('rolls back metres and PACKING when saving the WB scan fails',async()=>{
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED','true');
    const f=await fixture();
    const task=await db!.fbsTsdAssembly.update({where:{id:f.task.id},data:{sourceArticle:'__FABRIC_FBS__',marketplace:'WILDBERRIES',barcodes:['1234567890123']}});
    const ledger=reserveFabricOrder({rolls:f.state.rolls},task,f.state.fbsOrders![fabricOrderKey(f.owner)].lines);
    await db!.systemSetting.update({where:{key:`fabric.rolls.v1:${f.client.id}`},data:{value:ledger as any}});
    const service={prisma:{$transaction:(fn:any)=>db!.$transaction(tx=>fn({...tx,fbsTsdAssembly:{
      findUnique:tx.fbsTsdAssembly.findUnique.bind(tx.fbsTsdAssembly),update:async()=>{throw Error('Scan save failed');},
    }}))},requireCurrentFbsTsdLease:()=>{},fbsTsdDeviceCode:()=>task.deviceCode};
    await expect(scanWbFabric(service,task,'1234567890123',0,f.user)).rejects.toThrow('Scan save failed');
    const s=await f.snapshot();expect(s.state.rolls[0].remainingMm).toBe(100000);
    expect(s.movements).toHaveLength(0);expect(s.balances).toHaveLength(0);expect(s.audits).toBe(0);
  });
  it('commits raw meters and order-owned PACKING once across retries', async () => {
    const f = await fixture();
    await f.confirm();
    expect(await f.confirm()).toMatchObject({ replay: true, cutUnits: 0 });
    const s = await f.snapshot();
    expect(s.state.rolls[0].remainingMm).toBe(94000);
    expect(s.movements).toHaveLength(1);
    expect(s.balances).toHaveLength(1);
    expect(s.balances[0]).toMatchObject({ status: 'PACKING', quantity: 2 });
    expect(s.audits).toBe(1); expect(s.events).toBe(1);
  });
  it('rolls back stock, raw meters and audit together after writer failure', async () => {
    const f = await fixture();
    await expect(f.confirm(true)).rejects.toThrow('Injected failure');
    const s = await f.snapshot();
    expect(s.state.rolls[0].remainingMm).toBe(100000);
    expect(s.movements).toHaveLength(0); expect(s.balances).toHaveLength(0);
    expect(s.audits).toBe(0); expect(s.events).toBe(0);
    await expect(f.confirm()).resolves.toMatchObject({ cutUnits: 2 });
  });
  it('serializes concurrent confirmations of the same order', async () => {
    const f = await fixture();
    const results = await Promise.all([f.confirm(), f.confirm()]);
    expect(results.map(r => r.cutUnits).sort()).toEqual([0, 2]);
    const s = await f.snapshot();
    expect(s.state.rolls[0].remainingMm).toBe(94000);
    expect(s.movements).toHaveLength(1); expect(s.audits).toBe(1);
  });
  it('does not let two orders reserve the last available continuous cuts', async () => {
    const f = await fixture();
    const key = `fabric.rolls.v1:${f.client.id}`;
    await db!.systemSetting.update({ where: { key }, data: { value: { rolls: [{ ...f.state.rolls[0], remainingMm: 6000 }] } } });
    for (const prefix of ['fabric.rolls.enabled.v1:', 'fabric.fbs.enabled.v1:']) {
      await db!.systemSetting.create({ data: { key: prefix + f.client.id, value: { enabled: true } } });
    }
    const other = await db!.clientRequest.create({ data: { clientId: f.client.id, warehouseId: f.warehouse.id, type: 'OUTBOUND', title: 'Competing order' } });
    const otherItem = await db!.clientRequestItem.create({ data: { requestId: other.id, skuId: f.sku.id, quantity: 2 } });
    const claim = (requestId: string, lineId: string) => db!.$transaction(tx => assignFabricOrder(tx, {
      clientId: f.client.id, capability: true, owner: { ...f.owner, requestId, orderId: requestId },
      lines: [{ lineId, skuId: f.sku.id, warehouseId: f.warehouse.id, material: 'SATIN', color: 'white', lengthMm: 3000, units: 2 }],
    }, async () => 'claimed', true));
    const results = await Promise.allSettled([claim(f.request.id, f.item.id), claim(other.id, otherItem.id)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    const s = await f.snapshot();
    expect(s.state.fbsReservations).toHaveLength(1);
    expect(s.state.rolls[0].remainingMm).toBe(6000);
    expect(s.movements).toHaveLength(0);
  });
  it('rolls back a database task claim when reservation persistence fails', async () => {
    const f = await fixture();
    for (const prefix of ['fabric.rolls.enabled.v1:', 'fabric.fbs.enabled.v1:']) {
      await db!.systemSetting.create({ data: { key: prefix + f.client.id, value: { enabled: true } } });
    }
    await expect(db!.$transaction(tx => assignFabricOrder(tx, {
      clientId: f.client.id, capability: true, owner: f.owner, lines: f.state.fbsOrders![fabricOrderKey(f.owner)].lines,
    }, async () => {
      await tx.clientRequest.update({ where: { id: f.request.id }, data: { title: 'Must roll back' } });
      throw new Error('Failed claim');
    }, true))).rejects.toThrow('Failed claim');
    expect((await db!.clientRequest.findUniqueOrThrow({ where: { id: f.request.id } })).title).toBe(f.request.title);
  });
});
