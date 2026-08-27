import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  it('mass updates selected SKU volume as a manual override and writes audit', async () => {
    const tx = {
      sku: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    const prisma = {
      sku: {
        count: vi.fn().mockResolvedValue(2),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const clientScopes = {
      requireClientAccess: vi.fn(),
    };
    const service = new SkusService(prisma as never, clientScopes as never, new VolumeService());

    const result = await service.updateBulkVolume(
      {
        clientId: 'client-1',
        sourceVolumeFrom: 3,
        sourceVolumeTo: 4,
        skuIds: ['d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002'],
        newVolumeLiters: 4.25,
      },
      { id: 'user-1' } as never,
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith({ id: 'user-1' }, 'client-1', 'write');
    expect(tx.sku.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        clientId: 'client-1',
        id: { in: ['d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002'] },
      }),
      data: expect.objectContaining({
        volumeSource: 'MANUAL',
      }),
    });
    const update = tx.sku.updateMany.mock.calls[0][0];
    expect(Number(update.data.volumeLiters)).toBe(4.25);
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({
      updated: 2,
      sourceVolumeFrom: 3,
      sourceVolumeTo: 4,
      newVolumeLiters: 4.25,
    }));
  });

  it('keeps a manual volume when an API update brings new card dimensions', async () => {
    const existing = {
      id: 'sku-1',
      clientId: 'client-1',
      internalSku: 'SKU-1',
      clientSku: null,
      article: null,
      name: 'Старое название',
      brand: null,
      category: null,
      color: null,
      size: null,
      weightGrams: null,
      lengthCm: new Prisma.Decimal(20),
      widthCm: new Prisma.Decimal(10),
      heightCm: new Prisma.Decimal(5),
      volumeLiters: new Prisma.Decimal(7.5),
      volumeSource: 'MANUAL',
      needsChestnyZnak: false,
      isUnmarked: false,
      needsLabel: false,
      needsRelabel: false,
      marketplacePayload: null,
      barcodes: [],
    };
    const tx = {
      sku: {
        update: vi.fn().mockResolvedValue({}),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...existing, name: 'Новое название' }),
      },
      barcode: {
        deleteMany: vi.fn(),
        upsert: vi.fn(),
      },
    };
    const prisma = {
      sku: { findFirst: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const scopes = {
      resolveClientFilter: vi.fn().mockReturnValue(undefined),
      requireClientAccess: vi.fn(),
    };
    const service = new SkusService(prisma as never, scopes as never, new VolumeService());

    await service.update(
      'sku-1',
      {
        name: 'Новое название',
        lengthCm: 30,
        widthCm: 20,
        heightCm: 10,
      },
      {} as never,
    );

    const data = tx.sku.update.mock.calls[0][0].data;
    expect(data.name).toBe('Новое название');
    expect(data).toMatchObject({
      lengthCm: 30,
      widthCm: 20,
      heightCm: 10,
    });
    expect(data).not.toHaveProperty('volumeLiters');
    expect(data).not.toHaveProperty('volumeSource');
  });

  it('adds a product pair to the client relabeling table', async () => {
    const saved = {
      id: 'mapping-1',
      clientId: 'client-1',
      sourceArticle: 'Корея_2голубой',
      targetArticle: 'новый_корея_2голубой',
      comment: 'Переклейка для WB',
    };
    const prisma = {
      clientArticleMapping: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(saved),
        update: vi.fn(),
      },
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new SkusService(
      prisma as never,
      scopes as never,
      new VolumeService(),
    );

    const result = await service.createArticleMapping(
      {
        clientId: 'client-1',
        sourceArticle: '  Корея_2голубой ',
        targetArticle: ' новый_корея_2голубой ',
        comment: 'Переклейка для WB',
      },
      {} as never,
    );

    expect(scopes.requireClientAccess).toHaveBeenCalledWith(
      {},
      'client-1',
      'write',
    );
    expect(prisma.clientArticleMapping.create).toHaveBeenCalledWith({
      data: {
        clientId: 'client-1',
        sourceArticle: 'Корея_2голубой',
        targetArticle: 'новый_корея_2голубой',
        comment: 'Переклейка для WB',
      },
    });
    expect(result).toEqual(saved);
  });

  it('does not allow the same product on both sides of relabeling', async () => {
    const scopes = { requireClientAccess: vi.fn() };
    const service = new SkusService(
      { clientArticleMapping: {} } as never,
      scopes as never,
      new VolumeService(),
    );

    await expect(
      service.createArticleMapping(
        {
          clientId: 'client-1',
          sourceArticle: 'Костюм Ёлка',
          targetArticle: ' костюм елка ',
        },
        {} as never,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
