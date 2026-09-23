import { describe, expect, it, vi } from 'vitest';
import { SkusService } from './skus.service';

// TEST: a marketplace article must be searchable when choosing a label to print.
describe('SKU label lookup', () => {
  it('searches substrings of article, name, and barcode within the selected client scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { sku: { findMany } };
    const scopes = { resolveClientFilter: vi.fn().mockReturnValue('client-1') };
    const service = new SkusService(prisma as never, scopes as never, {} as never);
    await service.list({ clientId: 'client-1', search: 'спорт_синий' }, { warehouseId: null } as never);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      clientId: 'client-1', OR: expect.arrayContaining([
        { article: { contains: 'спорт_синий', mode: 'insensitive' } },
        { name: { contains: 'спорт_синий', mode: 'insensitive' } },
        { barcodes: { some: { value: { contains: 'спорт_синий' } } } },
      ]),
    }) }));
  });
});
