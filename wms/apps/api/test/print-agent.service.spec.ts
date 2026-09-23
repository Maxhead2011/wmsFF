import { describe, expect, it, vi } from 'vitest';
import { PrintAgentService } from '../src/modules/print/print-agent.service';

const png = (() => {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(709, 16);
  bytes.writeUInt32BE(472, 20);
  return bytes.toString('base64');
})();
const boxPng = (() => {
  const bytes = Buffer.from(png, 'base64');
  bytes.writeUInt32BE(590, 16);
  bytes.writeUInt32BE(354, 20);
  return bytes.toString('base64');
})();

function fixture() {
  const prisma = {
    fbsPrintStation: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue({ id: 'station-1' }) },
    sku: { findFirst: vi.fn().mockResolvedValue({ id: 'sku-1', clientId: 'client-1', name: 'Костюм', barcodes: [{ value: '2041234567890' }] }) },
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1' }) },
    printJob: {
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'job-1', ...data })),
      findFirst: vi.fn().mockResolvedValue({ id: 'job-1', status: 'queued', processedAt: null, payload: { imageBase64: png, copies: 2, widthMm: 60, heightMm: 40 } }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const scopes = { resolveClientFilter: vi.fn().mockReturnValue('client-1'), requireClientAccess: vi.fn() };
  return { service: new PrintAgentService(prisma as never, scopes as never), prisma, scopes };
}

// TEST: a client-scoped SKU label is handed to the existing Windows print station.
describe('PrintAgentService', () => {
  it('queues a scoped 60 × 40 image for the selected station and copy count', async () => {
    const { service, prisma } = fixture();
    const job = await service.createSkuJob({ stationId: 'station-1', skuId: 'sku-1', barcode: '2041234567890', imageBase64: png, copies: 2, widthMm: 60, heightMm: 40 }, { id: 'user-1' } as never);
    expect(job.printerCode).toBe('AGENT:station-1');
    expect(prisma.printJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'queued', payload: expect.objectContaining({ copies: 2, barcode: '2041234567890' }) }) }));
  });
  it('rejects a barcode absent from the card before queueing', async () => {
    const { service, prisma } = fixture();
    await expect(service.createSkuJob({ stationId: 'station-1', skuId: 'sku-1', barcode: 'other', imageBase64: png, widthMm: 60, heightMm: 40 }, { id: 'user-1' } as never)).rejects.toThrow('не найден');
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });
  it('claims one generic job atomically without touching the FBS queue', async () => {
    const { service, prisma } = fixture();
    const job = await service.claim('station-1');
    expect(job).toMatchObject({ id: 'job-1', copies: 2, imageBase64: png });
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-1', status: 'queued', processedAt: null } }));
  });
  // TEST: custom box labels require access to the selected client before using the agent.
  it('queues a serial box image for an accessible client', async () => {
    const { service, prisma, scopes } = fixture();
    const job = await service.createCustomJob({ stationId: 'station-1', clientId: 'client-1', value: 'FFL_LKB20260923_001', imageBase64: boxPng, copies: 1, widthMm: 50, heightMm: 30 }, { id: 'user-1' } as never);
    expect(scopes.requireClientAccess).toHaveBeenCalledWith(expect.anything(), 'client-1', 'read');
    expect(job.labelType).toBe('CUSTOM');
    expect(prisma.printJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ value: 'FFL_LKB20260923_001', widthMm: 50, heightMm: 30 }) }) }));
  });
});
