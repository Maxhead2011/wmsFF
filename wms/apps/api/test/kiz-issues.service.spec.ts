import { ClientRequestStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { KizIssuesService } from '../src/modules/kiz-issues/kiz-issues.service';

describe('KizIssuesService', () => {
  it('shows a wrong-product scan with the previous request, WB order, product and box', async () => {
    const detectedAt = new Date('2026-07-30T10:00:00.000Z');
    const requests = [
      {
        id: 'request-attempt',
        number: 65,
        title: 'Заявка 65',
        status: ClientRequestStatus.SUBMITTED,
        clientId: 'client-1',
        warehouse: {
          id: 'warehouse-msk',
          code: 'MSK',
          city: 'Москва',
          name: 'Москва',
        },
      },
      {
        id: 'request-existing',
        number: 86,
        title: 'Заявка 86',
        status: ClientRequestStatus.SUBMITTED,
        clientId: 'client-1',
        warehouse: {
          id: 'warehouse-msk',
          code: 'MSK',
          city: 'Москва',
          name: 'Москва',
        },
      },
    ];
    const baseTask = {
      clientId: 'client-1',
      requiresKiz: true,
      deviceCode: 'TSD-1',
      workerName: 'Сотрудник',
      completedAt: null,
      createdAt: detectedAt,
      updatedAt: detectedAt,
      cargoPackedAt: null,
      barcode: '2000000000001',
      wbMetaStatus: 'NOT_REQUIRED',
      errorMessage: null,
      kiz: null,
    };
    const tasks = [
      {
        ...baseTask,
        id: 'assembly-attempt',
        requestId: 'request-attempt',
        orderId: 'WB-NEW',
        skuId: 'sku-new',
        productName: 'Корея_2бежевый',
        article: 'NEW-ART',
        status: 'IN_PROGRESS',
        boxId: 'box-new',
        boxCode: 'FFL_LKB2807_01',
      },
      {
        ...baseTask,
        id: 'assembly-existing',
        requestId: 'request-existing',
        orderId: 'WB-OLD',
        skuId: 'sku-existing',
        productName: 'Корея_2голубой',
        article: 'KOREA-2-BLUE',
        status: 'COMPLETED',
        boxId: 'box-existing',
        boxCode: 'FFL_LKB79_402',
      },
    ];
    const auditLogFindMany = vi.fn().mockImplementation(async ({ where }) => {
      if (where.action === 'FBS_KIZ_LOCAL_STATUS_CONFLICT') {
        return [
          {
            id: 'audit-conflict',
            entityId: 'request-attempt',
            createdAt: detectedAt,
            payload: {
              conflictType: 'WRONG_SKU',
              requestId: 'request-attempt',
              assemblyId: 'assembly-attempt',
              orderId: 'WB-NEW',
              boxCode: 'FFL_LKB2807_01',
              kiz: '010460000000000021ABC',
              detectedAt: detectedAt.toISOString(),
              message:
                'Этот КИЗ относится к другому товару: Корея_2голубой.',
              mark: {
                skuId: 'sku-existing',
                boxId: 'box-existing',
                status: 'SHIPPED',
                boxCode: 'FFL_LKB79_402',
              },
              existing: null,
            },
          },
        ];
      }
      return [];
    });
    const prisma = {
      clientRequest: {
        findMany: vi.fn().mockResolvedValue(requests),
      },
      fbsTsdAssembly: {
        findMany: vi.fn().mockResolvedValue(tasks),
      },
      auditLog: {
        findMany: auditLogFindMany,
      },
      client: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'client-1', code: 'CLIENT', name: 'Клиент' },
        ]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-new',
            internalSku: 'NEW-M',
            article: 'NEW-ART',
            name: 'Корея_2бежевый',
            color: 'бежевый',
            size: 'M',
          },
          {
            id: 'sku-existing',
            internalSku: 'KOREA-2-BLUE-M',
            article: 'KOREA-2-BLUE',
            name: 'Корея_2голубой',
            color: 'голубой',
            size: 'M',
          },
        ]),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'box-new', code: 'FFL_LKB2807_01' },
          { id: 'box-existing', code: 'FFL_LKB79_402' },
        ]),
      },
      productMark: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      shippedKizHistory: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          {
            clientId: 'client-1',
            skuId: 'sku-existing',
            boxId: 'box-existing',
            sourceDocument: 'request-existing',
            createdAt: new Date('2026-07-29T10:00:00.000Z'),
          },
        ]),
      },
    };
    const service = new KizIssuesService(prisma as never, {} as never);

    const report = await service.list(
      { status: 'open' },
      { activeWarehouseId: 'warehouse-msk' } as never,
    );

    const conflict = report.issues.find(
      (issue) => issue.kind === 'MARK_WRONG_SKU',
    );
    expect(conflict).toMatchObject({
      title: 'КИЗ относится к другому товару',
      explanation: 'Этот КИЗ относится к другому товару: Корея_2голубой.',
      request: { number: 65 },
      orderId: 'WB-NEW',
      duplicate: {
        existingRequestNumber: 86,
        existingOrderId: null,
        existingBoxCode: 'FFL_LKB79_402',
        existingProduct: {
          internalSku: 'KOREA-2-BLUE-M',
          article: 'KOREA-2-BLUE',
          name: 'Корея_2голубой',
          color: 'голубой',
          size: 'M',
        },
      },
    });
  });
});
