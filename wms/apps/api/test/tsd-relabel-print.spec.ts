import { expect, it, vi } from 'vitest';
import { TsdRelabelPrintService } from '../src/modules/tsd/tsd-relabel-print.service';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { buildTsdRelabelLabel } from '../src/modules/tsd/tsd-relabel-label';

vi.mock('../src/modules/tsd/tsd-relabel-label', () => ({ buildTsdRelabelLabel: vi.fn().mockResolvedValue('PNG') }));

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
      color: 'синий', size: 'M', brand: 'LOOK.IN' }]) },
    clientRequest: { findUniqueOrThrow: vi.fn().mockResolvedValue({ number: 1291 }) },
    fbsPrintJob: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(job),
      create: vi.fn().mockResolvedValue(job), findFirst: vi.fn().mockResolvedValue(job),
      update: vi.fn().mockResolvedValue(job), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(job) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const prisma = { ...db, $transaction: vi.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db)) };
  const assembly = { getRequestPlan: vi.fn().mockResolvedValue(plan) };
  return { service: new TsdRelabelPrintService(prisma as never, assembly as never), db, prisma, assembly, job };
}

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
  // TEST: TSD opens the verification scan only after this print job reaches PRINTED.
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
