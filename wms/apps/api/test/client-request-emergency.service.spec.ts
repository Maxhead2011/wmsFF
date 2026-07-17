import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { ClientRequestEmergencyService } from '../src/modules/client-requests/client-request-emergency.service';

describe('ClientRequestEmergencyService', () => {
  it('списывает фактический излишек и не блокирует упаковку при недостаче', async () => {
    const request = {
      id: 'request-1',
      clientId: 'client-1',
      type: 'OUTBOUND',
      status: 'IN_WORK',
      title: 'Поставка WB',
      managerComment: null,
      assignedToUserId: null,
      items: [
        {
          id: 'item-1',
          skuId: 'sku-1',
          barcode: '2040000000001',
          name: 'Костюм',
          quantity: 8,
          sku: {
            id: 'sku-1',
            internalSku: 'SKU-1',
            name: 'Костюм',
            barcodes: [{ value: '2040000000001', isPrimary: true }],
          },
        },
        {
          id: 'item-2',
          skuId: 'sku-target',
          barcode: '2050000000002',
          name: 'Футболка',
          quantity: 3,
          comment: 'Перемаркировка из: 2040000000002; Перемаркировка в: 2050000000002; Перемаркировка: да',
          sku: {
            id: 'sku-target',
            internalSku: 'SKU-TARGET',
            name: 'Футболка',
            barcodes: [{ value: '2050000000002', isPrimary: true }],
          },
        },
      ],
    };
    const box = {
      id: 'box-1',
      clientId: 'client-1',
      code: 'FFL_TEST_001',
      status: 'active',
      balances: [
        {
          id: 'balance-1',
          balanceKey: 'client-1:sku-1:box-1:AVAILABLE',
          clientId: 'client-1',
          skuId: 'sku-1',
          boxId: 'box-1',
          palletId: null,
          status: 'AVAILABLE',
          quantity: 10,
          sku: request.items[0].sku,
        },
        {
          id: 'balance-2',
          balanceKey: 'client-1:sku-source:box-1:AVAILABLE',
          clientId: 'client-1',
          skuId: 'sku-source',
          boxId: 'box-1',
          palletId: null,
          status: 'AVAILABLE',
          quantity: 2,
          sku: {
            id: 'sku-source',
            internalSku: 'SKU-SOURCE',
            name: 'Футболка до перемаркировки',
            barcodes: [{ value: '2040000000002', isPrimary: true }],
          },
        },
      ],
    };
    const tx = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockResolvedValue(undefined),
      },
      clientRequestItem: {
        create: vi.fn(),
      },
      stockMovement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn()
          .mockResolvedValueOnce({ id: 'movement-1' })
          .mockResolvedValueOnce({ id: 'movement-2' }),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([box]),
        update: vi.fn().mockResolvedValue(undefined),
      },
      stockBalance: {
        delete: vi.fn().mockResolvedValue(undefined),
      },
      productMark: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      clientRequestPackage: {
        findFirst: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockImplementation(({ data }: { data: { items: { create: Array<{ quantity: number }> } } }) =>
          Promise.resolve({
            id: 'package-1',
            packageCode: 'FFL_TEST_001',
            packageType: 'BOX',
            items: data.items.create,
          }),
        ),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(undefined),
      },
      clientRequestFile: {
        create: vi.fn().mockResolvedValue({ id: 'file-1' }),
      },
      clientRequestEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      billingInvoice: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      billingCharge: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      logisticsDeliveryRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({ id: 'request-1', clientId: 'client-1' }),
      },
      $transaction: (callback: (transaction: typeof tx) => unknown) => callback(tx),
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new ClientRequestEmergencyService(prisma as never, clientScopes as never);
    const file = buildBoxListFile(['FFL_TEST_001']);

    await expect(service.closeFromPackedXlsx('request-1', file, user())).resolves.toMatchObject({
      status: 'APPLIED',
      requestId: 'request-1',
      boxes: 1,
      packedUnits: 12,
      wbFilesReady: true,
      shortageQuantity: 1,
      excessQuantity: 2,
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: 'EXCESS', quantity: 2 }),
        expect.objectContaining({ code: 'RELABEL_DIFFERENCE', quantity: 1 }),
      ]),
    });

    expect(tx.stockBalance.delete).toHaveBeenCalledWith({ where: { id: 'balance-1' } });
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SHIP',
          quantity: -10,
          sourceDocument: 'request-1',
        }),
      }),
    );
    expect(tx.clientRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PACKED' }) }),
    );
    expect(tx.clientRequestPackage.create).toHaveBeenCalledTimes(1);
    expect(tx.clientRequestPackage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: expect.arrayContaining([
              expect.objectContaining({ requestItemId: 'item-1', quantity: 10 }),
              expect.objectContaining({ requestItemId: 'item-2', quantity: 2, barcode: '2050000000002' }),
            ]),
          },
        }),
      }),
    );
    expect(tx.clientRequestFile.create).toHaveBeenCalledTimes(1);
    expect(tx.clientRequestPackage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'package-1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            emergencyClosure: expect.objectContaining({
              previousStatus: 'IN_WORK',
              createdMovementIds: ['movement-1', 'movement-2'],
              sourceFileId: 'file-1',
            }),
          }),
        }),
      }),
    );
  });

  it('отменяет аварийное закрытие и возвращает остаток в исходный короб', async () => {
    const tx = buildRollbackTransaction();
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({ id: 'request-1', clientId: 'client-1' }),
      },
      $transaction: (callback: (transaction: typeof tx) => unknown) => callback(tx),
    };
    const service = new ClientRequestEmergencyService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );

    await expect(service.rollbackPackedXlsx('request-1', user())).resolves.toMatchObject({
      status: 'REVERSED',
      requestId: 'request-1',
      restoredStatus: 'IN_WORK',
      restoredBoxes: 1,
      restoredUnits: 5,
      removedPackages: 1,
    });

    expect(tx.stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { balanceKey: 'client-1:sku-1:box-1:no-pallet:AVAILABLE' },
        create: expect.objectContaining({ quantity: 5, boxId: 'box-1' }),
      }),
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'INVENTORY_ADJUSTMENT',
          quantity: 5,
          sourceDocument: 'request-1',
        }),
      }),
    );
    expect(tx.clientRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'IN_WORK' }) }),
    );
    expect(tx.clientRequestPackage.deleteMany).toHaveBeenCalledWith({ where: { requestId: 'request-1' } });
    expect(tx.clientRequestItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['auto-item-1'] } } });
  });

  it('не меняет склад, если автоматический счет уже выставлен', async () => {
    const tx = buildRollbackTransaction({ invoiceStatus: 'ISSUED' });
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({ id: 'request-1', clientId: 'client-1' }),
      },
      $transaction: (callback: (transaction: typeof tx) => unknown) => callback(tx),
    };
    const service = new ClientRequestEmergencyService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );

    await expect(service.rollbackPackedXlsx('request-1', user())).rejects.toThrow(
      'Счет USL-202607-0001 уже выставлен или оплачен',
    );
    expect(tx.stockBalance.upsert).not.toHaveBeenCalled();
    expect(tx.clientRequest.update).not.toHaveBeenCalled();
  });
});

function buildRollbackTransaction(options: { invoiceStatus?: 'DRAFT' | 'ISSUED' } = {}) {
  const closedAt = new Date('2026-07-15T10:00:00.000Z');
  return {
    clientRequest: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'request-1',
        clientId: 'client-1',
        title: 'Поставка WB',
        type: 'OUTBOUND',
        status: 'PACKED',
        managerComment: 'Аварийно упаковано',
        assignedToUserId: 'user-1',
      }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    clientRequestPackage: {
      findMany: vi.fn().mockResolvedValue([{ id: 'package-1', metadata: null }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue(undefined),
    },
    clientRequestEvent: {
      findFirst: vi.fn().mockResolvedValue({ statusFrom: 'IN_WORK', createdAt: closedAt }),
      create: vi.fn().mockResolvedValue(undefined),
    },
    stockMovement: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'movement-1',
          clientId: 'client-1',
          skuId: 'sku-1',
          boxId: 'box-1',
          palletId: null,
          status: 'AVAILABLE',
          quantity: -5,
        },
      ]),
      create: vi.fn().mockResolvedValue({ id: 'rollback-movement-1' }),
    },
    billingInvoice: {
      findMany: vi.fn().mockResolvedValue(
        options.invoiceStatus
          ? [{ id: 'invoice-1', number: 'USL-202607-0001', status: options.invoiceStatus, payments: [] }]
          : [],
      ),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    logisticsDeliveryRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    billingCharge: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    stockBalance: {
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    productMark: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    box: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    clientRequestItem: {
      findMany: vi.fn().mockResolvedValue([{ id: 'auto-item-1' }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    clientRequestFile: {
      findFirst: vi.fn().mockResolvedValue({ id: 'file-1' }),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function buildBoxListFile(boxCodes: string[]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Короб'], ...boxCodes.map((code) => [code])]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Короба');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return {
    fieldname: 'file',
    originalname: 'короба.xlsx',
    encoding: '7bit',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

function user(): AuthUser {
  return {
    id: 'user-1',
    email: 'admin@logoff.pro',
    name: 'Администратор',
    roleCodes: ['ADMIN'],
    permissionCodes: ['system:admin'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };
}
