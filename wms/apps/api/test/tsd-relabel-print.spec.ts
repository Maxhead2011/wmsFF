import { afterEach, expect, it, vi } from 'vitest';
import { TsdRelabelPrintService } from '../src/modules/tsd/tsd-relabel-print.service';
import { createRequire } from 'node:module';
// TEST: source-only mocks missed the relabel methods lost from the deployed service.
const { MarketplaceConnectionsService } = process.env.FBS_RUNTIME_ENTRY
  ? createRequire(import.meta.url)(process.env.FBS_RUNTIME_ENTRY)
  : await import('../src/modules/marketplace-connections/marketplace-connections.service');
import { buildTsdRelabelLabel } from '../src/modules/tsd/tsd-relabel-label';

vi.mock('../src/modules/tsd/tsd-relabel-label', () => ({ buildTsdRelabelLabel: vi.fn().mockResolvedValue('PNG') }));
afterEach(() => vi.unstubAllEnvs());

const printId = '11111111-1111-4111-8111-111111111111';
const user = { id: 'worker', name: 'Склад', deviceCode: 'TSD-1', activeWarehouseId: 'wh' } as never;
const input = { printId, stationId: 'station', sourceBox: 'FFL_LKB2409_001',
  oldBarcode: '2040000000001', newBarcode: '2040000000002', size: 'M' };
const plan = { client: { id: 'lukin', name: 'ИП Лукин Илья Ильич' }, relabelTasks: [{
  sourceBox: input.sourceBox, oldBarcode: input.oldBarcode, newBarcode: input.newBarcode,
  size: input.size, remainingQuantity: 1,
}] };

function fixture() {
  const job = { id: 'job', historyId: printId, source: 'TSD_RELABEL', requestId: 'request',
    requestedById: 'worker', stationId: 'station', stickerCode: input.newBarcode,
    status: 'QUEUED', errorMessage: null, printedAt: null, stickerBase64: 'PNG' };
  const db = {
    fbsPrintStation: { findFirst: vi.fn().mockResolvedValue({ id: 'station' }),
      findMany: vi.fn().mockResolvedValue([{ id: 'station', name: '2409' }]),
      update: vi.fn().mockResolvedValue({ id: 'station' }) },
    sku: { findMany: vi.fn().mockResolvedValue([{ id: 'target', name: 'Костюм', article: 'Корея',
      color: 'синий', size: 'M', brand: 'LOOK.IN' }]),
      findUnique: vi.fn().mockResolvedValue({ id: 'target', clientId: 'lukin', name: 'Костюм',
        article: 'Корея', color: 'синий', size: 'M', brand: 'LOOK.IN' }) },
    client: { findUnique: vi.fn().mockResolvedValue({ name: plan.client.name }) },
    clientRequest: { findUniqueOrThrow: vi.fn().mockResolvedValue({ number: 1291 }) },
    fbsPrintJob: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(job),
      create: vi.fn().mockResolvedValue(job), findFirst: vi.fn().mockResolvedValue(job),
      update: vi.fn().mockResolvedValue(job), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(job) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const prisma = { ...db, $transaction: vi.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db)) };
  const assembly = { getRequestPlan: vi.fn().mockResolvedValue(plan) };
  const marketplace = { getFbsTsdRelabelPrintContext: vi.fn().mockResolvedValue({
    taskId: 'fbs-task', requestId: 'request', clientId: 'lukin', skuId: 'target',
    sourceBarcode: input.oldBarcode, targetBarcodes: [input.newBarcode],
  }) };
  return { service: new TsdRelabelPrintService(prisma as never, assembly as never, marketplace as never),
    db, prisma, assembly, marketplace, job };
}

it('prints two target labels from the source-scanned FBS task, independent of the relabel menu', async () => {
  // TEST: request 1316 reaches SCAN_RELABEL_BARCODE inside FBS assembly, where the old endpoint had no task.
  const f = fixture();
  const created = { ...f.job, assemblyId: 'fbs-task' };
  f.db.fbsPrintJob.create.mockResolvedValue(created);
  const result = await f.service.fbsCreate('fbs-task', {
    printId, stationId: 'station', newBarcode: input.newBarcode,
  }, user);
  expect(result).toMatchObject({ status: 'QUEUED', barcode: input.newBarcode });
  expect(f.db.fbsPrintJob.create.mock.calls[0][0].data).toMatchObject({
    source: 'TSD_RELABEL', assemblyId: 'fbs-task', requestId: 'request', stickerCode: input.newBarcode,
  });
  expect(buildTsdRelabelLabel).toHaveBeenCalledWith(input.newBarcode, expect.any(Object), plan.client.name);
});

it('rejects printing a barcode outside the current FBS target card', async () => {
  // TEST: a stale or forged button cannot print another product's label.
  const f = fixture();
  await expect(f.service.fbsCreate('fbs-task', { printId, stationId: 'station', newBarcode: 'wrong' }, user))
    .rejects.toMatchObject({ status: 409 });
  expect(f.db.fbsPrintJob.create).not.toHaveBeenCalled();
});

it('queues one idempotent relabel pair only for the matching request task and target SKU', async () => {
  // TEST: a repeated HTTP request must not queue four physical labels.
  const f = fixture();
  const first = await f.service.create('request', input, user);
  const second = await f.service.create('request', input, user);
  expect(first).toEqual(second);
  expect(f.db.fbsPrintJob.create).toHaveBeenCalledTimes(1);
  expect(f.db.fbsPrintJob.create.mock.calls[0][0].data).toMatchObject({ source: 'TSD_RELABEL',
    requestNumber: 1291, stickerCode: input.newBarcode, stickerBase64: 'PNG', historyId: printId });
  expect(f.db.sku.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'lukin',
    barcodes: { some: { value: input.newBarcode } } });
  expect(buildTsdRelabelLabel).toHaveBeenCalledWith(input.newBarcode, expect.any(Object), plan.client.name);
});

it('refuses an old-to-new barcode pair absent from the active relabel task', async () => {
  // TEST: the terminal must never print a different client's or task's target label.
  const f = fixture();
  await expect(f.service.create('request', { ...input, newBarcode: 'wrong' }, user)).rejects.toMatchObject({ status: 409 });
  expect(f.db.fbsPrintJob.create).not.toHaveBeenCalled();
});

it('reports the agent acknowledgement only to the worker who queued the pair', async () => {
  // TEST: report real printing status without exposing another worker's job.
  const f = fixture();
  f.db.fbsPrintJob.findUnique.mockReset().mockResolvedValue({ ...f.job, status: 'PRINTED', printedAt: new Date() });
  await expect(f.service.status('request', printId, user)).resolves.toMatchObject({
    printId, status: 'PRINTED', barcode: input.newBarcode,
  });
  await expect(f.service.status('request', printId, { id: 'other' } as never)).rejects.toMatchObject({ status: 404 });
});

it('hands the unchanged quiet agent two identical relabel images without auto-reclaiming a claimed pair', async () => {
  // TEST: preserve ordinary WB print jobs while routing a relabel pair through the existing agent.
  const f = fixture();
  const marketplace = new MarketplaceConnectionsService(f.prisma as never, {} as never);
  const claimed = await marketplace.claimFbsPrintJob('station', user);
  expect(claimed.sortingLabel.imageBase64).toBe(claimed.stickerBase64);
  expect(f.db.fbsPrintJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'job', status: 'QUEUED' },
  }));
  expect(f.db.fbsPrintJob.findFirst.mock.calls[0][0].where.OR[1].source).toEqual({ not: 'TSD_RELABEL' });
});

it('uses the real assembly context from station discovery through queue creation', async () => {
  // TEST: reproduces request 1317: the source scan succeeds but the print context is missing in runtime.
  const f = fixture();
  const marketplace: any = new MarketplaceConnectionsService(f.prisma as never, {} as never);
  const task = { id: 'fbs-task', requestId: 'request', clientId: 'lukin', skuId: 'target',
    status: 'IN_PROGRESS', marketplace: 'WILDBERRIES', boxId: 'box', boxCode: input.sourceBox,
    relabelRequired: true, sourceBarcode: input.oldBarcode, barcode: null, barcodes: [input.newBarcode] };
  vi.spyOn(marketplace, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
  const service = new TsdRelabelPrintService(f.prisma as never, f.assembly as never, marketplace);
  expect(await service.fbsStations(task.id, user)).toEqual([{ id: 'station', name: '2409' }]);
  f.db.fbsPrintJob.create.mockResolvedValue({ ...f.job, assemblyId: task.id });
  expect(await service.fbsCreate(task.id, input, user)).toMatchObject({ status: 'QUEUED' });
  expect(f.db.fbsPrintJob.create).toHaveBeenCalledTimes(1);
  expect(marketplace.loadOwnedFbsTsdAssembly).toHaveBeenCalledWith(task.id, user);
});

it('rejects a changed relabel stage before looking up a printer', async () => {
  // TEST: restoring the method must retain the current-task/source-scan guard.
  const f = fixture();
  const marketplace: any = new MarketplaceConnectionsService(f.prisma as never, {} as never);
  vi.spyOn(marketplace, 'loadOwnedFbsTsdAssembly').mockResolvedValue({ status: 'COMPLETED' });
  const service = new TsdRelabelPrintService(f.prisma as never, f.assembly as never, marketplace);
  await expect(service.fbsStations('task', user)).rejects.toMatchObject({ status: 409 });
  expect(f.db.fbsPrintStation.findMany).not.toHaveBeenCalled();
});

it('does not return a relabel pair to a second concurrent agent', async () => {
  // TEST: a failed atomic claim cannot print another physical pair.
  const f = fixture();
  f.db.fbsPrintJob.updateMany.mockResolvedValue({ count: 0 });
  const marketplace: any = new MarketplaceConnectionsService(f.prisma as never, {} as never);
  expect(await marketplace.claimFbsPrintJob('station', user)).toBeNull();
});

it('records relabel acknowledgement without treating product labels as a shipment', async () => {
  // TEST: even a historical SOS device name cannot make relabel printing write off stock.
  vi.stubEnv('WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED', 'true');
  const f = fixture();
  f.db.fbsPrintJob.findUniqueOrThrow.mockResolvedValue({ ...f.job, status: 'PRINTED', deviceCode: 'SOS-WB:2409' } as any);
  const marketplace = new MarketplaceConnectionsService(f.prisma as never, {} as never);
  await marketplace.finishFbsPrintJob('job', true, null, user);
  expect(f.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ action: 'TSD_RELABEL_TWO_LABELS_PRINTED' }),
  }));
  expect(f.prisma.$transaction).not.toHaveBeenCalled();
});
