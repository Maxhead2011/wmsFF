// TEST: the complete history includes successful operations, nested scan data and screenshots.
import { TsdOperationStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TsdPayloadParser } from '../src/modules/tsd/tsd-payload.parser';
import { TsdReviewService } from '../src/modules/tsd/tsd-review.service';

describe('TsdReviewService: полная история операций', () => {
  it('возвращает все операции, а не только разобранные, с точным исполнителем и признаком снимка', async () => {
    const createdAt = new Date('2026-09-01T07:15:30.000Z');
    const prisma = {
      tsdOperation: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'operation-1',
            deviceId: 'TSD-01',
            operationKey: 'audit-1',
            operationType: 'tsd_api_action',
            payload: {
              actor: { userId: 'worker-1', name: 'Анна' },
              request: { path: '/api/v1/tsd/storage-pallet/scan', body: { palletCode: 'PALLET_SORT_40' } },
            },
            status: TsdOperationStatus.ACCEPTED,
            serverMessage: null,
            reviewReason: null,
            resolutionMessage: null,
            reviewAction: null,
            reviewComment: null,
            reviewedByUserId: null,
            reviewedBy: null,
            reviewedAt: null,
            screenshotMimeType: 'image/jpeg',
            screenshotCapturedAt: createdAt,
            createdAt,
            updatedAt: createdAt,
          },
        ]),
      },
      tsdDevice: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'device-id-1', code: 'TSD-01', name: 'ТСД приёмки', user: { id: 'worker-1', name: 'Анна', email: 'anna@example.com' } },
        ]),
      },
    };
    const clientScopes = { requireGlobalClientAccess: vi.fn() };
    const service = new TsdReviewService(
      prisma as never,
      clientScopes as never,
      {} as never,
      new TsdPayloadParser(),
    );

    await expect(service.listOperationHistory(user(), { page: 1, pageSize: 50 })).resolves.toMatchObject({
      total: 1,
      page: 1,
      pageSize: 50,
      items: [
        {
          id: 'operation-1',
          device: { code: 'TSD-01', name: 'ТСД приёмки' },
          actor: { id: 'worker-1', name: 'Анна', email: 'anna@example.com' },
          hasScreenshot: true,
          createdAt: '2026-09-01T07:15:30.000Z',
        },
      ],
    });
    expect(clientScopes.requireGlobalClientAccess).toHaveBeenCalled();
    expect(prisma.tsdOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        skip: 0,
        take: 50,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('отдаёт изображение только для существующей операции со снимком', async () => {
    const prisma = {
      tsdOperation: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'operation-1',
          screenshotData: Buffer.from('jpeg-data'),
          screenshotMimeType: 'image/jpeg',
          screenshotCapturedAt: new Date('2026-09-01T07:15:30.000Z'),
        }),
      },
    };
    const service = new TsdReviewService(
      prisma as never,
      { requireGlobalClientAccess: vi.fn() } as never,
      {} as never,
      new TsdPayloadParser(),
    );

    await expect(service.getOperationScreenshot('operation-1', user())).resolves.toMatchObject({
      mimeType: 'image/jpeg',
      content: Buffer.from('jpeg-data'),
    });
  });

  it('ищет паллеты, короба, товары, ШК и КИЗ внутри полного payload', async () => {
    const prisma = {
      tsdOperation: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      tsdDevice: { findMany: vi.fn() },
    };
    const service = new TsdReviewService(
      prisma as never,
      { requireGlobalClientAccess: vi.fn() } as never,
      {} as never,
      new TsdPayloadParser(),
    );

    await service.listOperationHistory(user(), { page: 1, pageSize: 50, search: 'PALLET_SORT_40' });

    expect(prisma.tsdOperation.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { payload: { path: ['palletCode'], string_contains: 'PALLET_SORT_40', mode: 'insensitive' } },
          { payload: { path: ['request', 'body', 'palletCode'], string_contains: 'PALLET_SORT_40', mode: 'insensitive' } },
        ]),
      }),
    });
  });
});

function user(): AuthUser {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Администратор',
    roleCodes: ['OWNER'],
    permissionCodes: ['system:admin', 'stock:write'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
    warehouseIds: [],
    writableWarehouseIds: [],
  };
}
