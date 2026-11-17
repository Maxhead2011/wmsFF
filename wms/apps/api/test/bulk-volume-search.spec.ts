import { validate } from 'class-validator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkusService } from '../src/modules/skus/skus.service';
import { BulkUpdateSkuVolumeDto } from '../src/modules/skus/dto/bulk-update-sku-volume.dto';
import { VolumeService } from '../src/modules/stock/volume.service';

const skuId = 'd1000000-0000-4000-8000-000000000001';
function setup() {
  const tx = { sku: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, auditLog: { create: vi.fn() } };
  const prisma = {
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1' }) },
    sku: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([{ id: skuId, volumeLiters: null }]), count: vi.fn().mockResolvedValue(1) },
    $transaction: vi.fn((callback) => callback(tx)),
  };
  const scopes = { requireClientAccess: vi.fn() };
  return { prisma, tx, scopes, service: new SkusService(prisma as never, scopes as never, new VolumeService()) };
}
const payload = () => Object.assign(new BulkUpdateSkuVolumeDto(), {
  clientId: 'client-1', search: '00123', skuIds: [skuId], newVolumeLiters: 2.5,
});

describe('bulk volume product search', () => {
  beforeEach(() => vi.stubEnv('WMS_BULK_VOLUME_SEARCH_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  // TEST: product identifiers must find cards even with no current volume or range.
  it.each(['ART-1', '00123'])('searches article/client SKU and all barcodes for %s within the client', async (search) => {
    const { service, prisma, scopes } = setup();
    const result = await service.listBulkVolume({ clientId: 'client-1', search: ` ${search} ` } as never, {} as never);
    expect(result.items).toHaveLength(1);
    expect(scopes.requireClientAccess).toHaveBeenCalledWith({}, 'client-1', 'read');
    expect(prisma.sku.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      clientId: 'client-1', OR: [
        { article: { contains: search, mode: 'insensitive' } },
        { clientSku: { contains: search, mode: 'insensitive' } },
        { barcodes: { some: { value: { contains: search } } } },
      ],
    } }));
  });

  // TEST: search augments a complete range; it must never silently discard one bound.
  it('combines search and volume limits', async () => {
    const { service, prisma } = setup();
    await service.listBulkVolume({ clientId: 'client-1', search: '00123', sourceVolumeFrom: '1', sourceVolumeTo: '3' } as never, {} as never);
    const where = prisma.sku.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(3);
    expect(Number(where.volumeLiters.gte)).toBe(1);
    expect(Number(where.volumeLiters.lte)).toBe(3);
  });
  it('keeps an incomplete range empty', async () => {
    const { service, prisma } = setup();
    expect((await service.listBulkVolume({ clientId: 'client-1', search: '00123', sourceVolumeFrom: '1' } as never, {} as never)).items).toEqual([]);
    expect(prisma.sku.findMany).not.toHaveBeenCalled();
  });
  it('does not list the entire client without a search or range', async () => {
    const { service, prisma } = setup();
    expect((await service.listBulkVolume({ clientId: 'client-1', search: '   ' } as never, {} as never)).items).toEqual([]);
    expect(prisma.sku.findMany).not.toHaveBeenCalled();
  });

  // TEST: only explicit IDs matching the same search and client may be changed.
  it('updates selected search matches without a range and records the search in audit', async () => {
    const { service, prisma, tx } = setup();
    const result = await service.updateBulkVolume(payload(), { id: 'user-1' } as never);
    expect(result.updated).toBe(1);
    const where = prisma.sku.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ clientId: 'client-1', id: { in: [skuId] }, OR: expect.any(Array) });
    expect(where.volumeLiters).toBeUndefined();
    expect(tx.sku.updateMany.mock.calls[0][0].where).toEqual(where);
    expect(Object.keys(tx.sku.updateMany.mock.calls[0][0].data).sort()).toEqual(['volumeLiters', 'volumeSource']);
    expect(tx.auditLog.create.mock.calls[0][0].data.payload.search).toBe('00123');
  });
  it('accepts a DTO with search and no range', async () => {
    expect(await validate(payload())).toEqual([]);
  });
  it.each([{ search: ' ' }, { sourceVolumeFrom: 1 }, { sourceVolumeTo: 3 }])('rejects unsafe selection %j', async (override) => {
    const { service, tx } = setup();
    await expect(service.updateBulkVolume(Object.assign(payload(), override), {} as never)).rejects.toThrow();
    expect(tx.sku.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a changed product or another client before writing', async () => {
    const { service, prisma, tx } = setup();
    prisma.sku.count.mockResolvedValue(0);
    await expect(service.updateBulkVolume(payload(), {} as never)).rejects.toThrow('Обновите список');
    expect(tx.sku.updateMany).not.toHaveBeenCalled();
  });
  it('aborts the transaction if matching products change during submission', async () => {
    const { service, tx } = setup();
    tx.sku.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateBulkVolume(payload(), {} as never)).rejects.toThrow('Обновите список');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  // TEST: sold installations retain range-only behavior with the flag disabled.
  it('rejects search when the feature is disabled, including search plus a range', async () => {
    vi.stubEnv('WMS_BULK_VOLUME_SEARCH_ENABLED', 'false');
    const { service, tx } = setup();
    await expect(service.listBulkVolume({ clientId: 'client-1', search: '00123' } as never, {} as never)).rejects.toThrow();
    await expect(service.updateBulkVolume(Object.assign(payload(), { sourceVolumeFrom: 1, sourceVolumeTo: 3 }), {} as never)).rejects.toThrow();
    expect(tx.sku.updateMany).not.toHaveBeenCalled();
  });
});
