import { BadRequestException } from '@nestjs/common';
import { ClientRequestPriority, ClientRequestStatus, ClientRequestType } from '@prisma/client';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { ClientRequestMarketplaceFilesService } from '../src/modules/client-requests/client-request-marketplace-files.service';

describe('ClientRequestMarketplaceFilesService', () => {
  it('creates WB product and package templates from packed places', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(requestFixture(ClientRequestStatus.PACKED)),
      },
    };
    const scopes = {
      requireClientAccess: vi.fn(),
    };
    const service = new ClientRequestMarketplaceFilesService(prisma as never, scopes as never);

    const products = await service.getWbProductsTemplate('request-1', user());
    const packages = await service.getWbPackagingTemplate('request-1', user());

    expect(scopes.requireClientAccess).toHaveBeenCalledWith(expect.any(Object), 'client-1', 'read');
    expect(rows(products.content, 'Sheet1')).toEqual([
      ['Баркод', 'Количество'],
      ['2040000000001', 5],
      ['2040000000002', 2],
    ]);
    expect(rows(packages.content, 'TDSheet')).toEqual([
      ['Баркод товара', 'Кол-во товаров', 'ШК короба', 'Срок годности'],
      ['2040000000001', 3, 'BOX-1', '30.07.2026'],
      ['2040000000002', 2, 'BOX-1', ''],
      ['2040000000001', 2, 'BOX-2', '30.07.2026'],
    ]);
  });

  it('blocks WB templates before packing', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(requestFixture(ClientRequestStatus.IN_WORK)),
      },
    };
    const service = new ClientRequestMarketplaceFilesService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await expect(service.getWbProductsTemplate('request-1', user())).rejects.toThrow(BadRequestException);
  });
});

function rows(buffer: Buffer, sheetName: string) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: true,
    blankrows: false,
  });
}

function requestFixture(status: ClientRequestStatus) {
  const sku1 = {
    id: 'sku-1',
    internalSku: 'SKU-1',
    clientSku: null,
    article: null,
    name: 'Товар 1',
    shelfLifeUntil: new Date('2026-07-30T00:00:00.000Z'),
    barcodes: [{ value: '2040000000001', isPrimary: true }],
  };
  const sku2 = {
    id: 'sku-2',
    internalSku: 'SKU-2',
    clientSku: null,
    article: null,
    name: 'Товар 2',
    shelfLifeUntil: null,
    barcodes: [{ value: '2040000000002', isPrimary: true }],
  };

  return {
    id: 'request-1',
    clientId: 'client-1',
    type: ClientRequestType.OUTBOUND,
    status,
    priority: ClientRequestPriority.NORMAL,
    title: 'Поставка WB',
    client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
    packages: [
      {
        id: 'package-1',
        requestId: 'request-1',
        clientId: 'client-1',
        packageCode: 'BOX-1',
        packageType: 'BOX',
        items: [
          {
            id: 'package-item-1',
            packageId: 'package-1',
            requestItemId: 'item-1',
            skuId: 'sku-1',
            barcode: '2040000000001',
            quantity: 3,
            sku: sku1,
            requestItem: {
              id: 'item-1',
              barcode: '2040000000001',
              name: null,
              quantity: 5,
              sku: sku1,
            },
          },
          {
            id: 'package-item-2',
            packageId: 'package-1',
            requestItemId: 'item-2',
            skuId: 'sku-2',
            barcode: '2040000000002',
            quantity: 2,
            sku: sku2,
            requestItem: {
              id: 'item-2',
              barcode: '2040000000002',
              name: null,
              quantity: 2,
              sku: sku2,
            },
          },
        ],
      },
      {
        id: 'package-2',
        requestId: 'request-1',
        clientId: 'client-1',
        packageCode: 'BOX-2',
        packageType: 'BOX',
        items: [
          {
            id: 'package-item-3',
            packageId: 'package-2',
            requestItemId: 'item-1',
            skuId: 'sku-1',
            barcode: '2040000000001',
            quantity: 2,
            sku: sku1,
            requestItem: {
              id: 'item-1',
              barcode: '2040000000001',
              name: null,
              quantity: 5,
              sku: sku1,
            },
          },
        ],
      },
    ],
  };
}

function user(): AuthUser {
  return {
    id: 'user-1',
    email: 'manager@example.com',
    name: 'Manager',
    roleCodes: ['MANAGER'],
    permissionCodes: ['client-requests:read', 'stock:write'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };
}
