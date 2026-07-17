import { describe, expect, it, vi } from 'vitest';
import { SkusService } from '../src/modules/skus/skus.service';
import { VolumeService } from '../src/modules/stock/volume.service';

describe('SkusService', () => {
  it('creates manual SKU card with dimensions, flags and photos', async () => {
    const createdSku = { id: 'sku-1' };
    const savedSku = {
      id: 'sku-1',
      marketplacePayload: { manualPhotos: ['https://cdn.example.com/photo.jpg'] },
      barcodes: [{ value: '2040000000011', isPrimary: true }],
    };
    const tx = {
      sku: {
        create: vi.fn().mockResolvedValue(createdSku),
        findUniqueOrThrow: vi.fn().mockResolvedValue(savedSku),
      },
      barcode: {
        create: vi.fn().mockResolvedValue({ id: 'barcode-1' }),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const clientScopes = {
      requireClientAccess: vi.fn(),
    };
    const service = new SkusService(prisma as never, clientScopes as never, new VolumeService());

    const result = await service.create(
      {
        clientId: 'client-1',
        internalSku: ' WB-ART-001 ',
        clientSku: 'seller-001',
        article: 'WB-123',
        name: 'Спортивный костюм',
        barcode: '2040000000011',
        photoUrls: ['https://cdn.example.com/photo.jpg', 'not-a-photo'],
        brand: 'LOGOFF',
        category: 'Одежда',
        color: 'черный',
        size: 'M',
        weightGrams: 450,
        lengthCm: 45,
        widthCm: 35,
        heightCm: 6,
        needsChestnyZnak: true,
        isUnmarked: true,
        needsLabel: true,
        needsRelabel: true,
      },
      {} as never,
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith({}, 'client-1', 'write');
    expect(tx.sku.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client-1',
        internalSku: 'WB-ART-001',
        article: 'WB-123',
        name: 'Спортивный костюм',
        brand: 'LOGOFF',
        category: 'Одежда',
        weightGrams: 450,
        lengthCm: 45,
        widthCm: 35,
        heightCm: 6,
        volumeLiters: 9.45,
        volumeSource: 'CALCULATED',
        needsChestnyZnak: true,
        isUnmarked: true,
        needsLabel: true,
        needsRelabel: true,
        marketplacePayload: { manualPhotos: ['https://cdn.example.com/photo.jpg'] },
      }),
    });
    expect(tx.barcode.create).toHaveBeenCalledWith({
      data: { skuId: 'sku-1', value: '2040000000011', isPrimary: true },
    });
    expect(result.marketplacePhotos).toEqual(['https://cdn.example.com/photo.jpg']);
  });

  it('updates an item in the shared nomenclature and clears optional fields', async () => {
    const existing = {
      id: 'nomenclature-1',
      internalSku: 'SKU-OLD',
      article: 'ART-OLD',
      barcode: '2040000000011',
      name: 'Старое название',
      printName: 'Старое название для печати',
      unit: 'шт',
      itemType: 'Одежда',
      color: 'черный',
      size: 'M',
      needsChestnyZnak: false,
    };
    const prisma = {
      nomenclatureItem: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue({ ...existing, name: 'Новое название', article: null }),
      },
    };
    const service = new SkusService(prisma as never, {} as never, new VolumeService());

    await service.updateNomenclature('nomenclature-1', {
      internalSku: ' SKU-NEW ',
      article: '',
      barcode: '2040000000028',
      name: ' Новое название ',
      printName: '',
      unit: 'шт',
      itemType: 'Костюм',
      color: 'синий',
      size: 'L',
      needsChestnyZnak: true,
    });

    expect(prisma.nomenclatureItem.update).toHaveBeenCalledWith({
      where: { id: 'nomenclature-1' },
      data: expect.objectContaining({
        internalSku: 'SKU-NEW',
        article: null,
        barcode: '2040000000028',
        name: 'Новое название',
        printName: null,
        color: 'синий',
        size: 'L',
        needsChestnyZnak: true,
      }),
    });
  });
});
