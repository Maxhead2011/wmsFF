import * as XLSX from 'xlsx';
import { ClientRequestPriority } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { ClientRequestXlsxService } from '../src/modules/client-requests/client-request-xlsx.service';

describe('ClientRequestXlsxService', () => {
  it('показывает доступность SKU и дефицит по Excel-файлу', async () => {
    const prisma = {
      barcode: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-1',
            value: '460000000001',
            sku: { id: 'sku-1', internalSku: 'BAR-001', name: 'Товар 1' },
          },
          {
            skuId: 'sku-2',
            value: '460000000002',
            sku: { id: 'sku-2', internalSku: 'BAR-002', name: 'Товар 2' },
          },
        ]),
      },
    };
    const service = new ClientRequestXlsxService(
      prisma as never,
      new ClientScopeService(),
      {
        create: vi.fn(),
        previewAvailability: vi.fn().mockResolvedValue({
          lines: [
            availabilityLine({ index: 0, skuId: 'sku-1', requestedQuantity: 4, stockQuantity: 5, availableQuantity: 5 }),
            availabilityLine({
              index: 1,
              skuId: 'sku-2',
              requestedQuantity: 2,
              stockQuantity: 3,
              reservedQuantity: 2,
              availableQuantity: 1,
              conflicts: [
                {
                  requestId: 'request-active',
                  title: 'Заявка 42',
                  type: 'OUTBOUND',
                  status: 'IN_WORK',
                  createdAt: '2026-06-25T10:00:00.000Z',
                  desiredDate: null,
                  quantity: 2,
                },
              ],
            }),
          ],
        }),
      } as never,
    );

    const preview = await service.previewOutboundRequest(
      fileFixture([
        ['barcode', 'qty'],
        ['460000000001', 4],
        ['460000000002', 2],
      ]),
      { clientId: 'client-1', title: 'Excel сборка', destinationCity: 'Казань' },
      user({ writableClientIds: ['client-1'], clientIds: ['client-1'] }),
    );

    expect(preview.canCommit).toBe(false);
    expect(preview.summary).toMatchObject({ lines: 2, totalQuantity: 6, availableQuantity: 5, shortageQuantity: 1 });
    expect(preview.lines[0]).toMatchObject({ skuId: 'sku-1', requestedQuantity: 4, availableQuantity: 5, canFulfill: true });
    expect(preview.lines[1].conflicts[0]).toMatchObject({ requestId: 'request-active', title: 'Заявка 42' });
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ barcode: '460000000002', severity: 'error', message: expect.stringContaining('Недостаточно') }),
    );
  });

  it('создает outbound-заявку из валидного Excel-файла', async () => {
    const clientRequests = {
      create: vi.fn().mockResolvedValue({ id: 'request-1', title: 'Excel сборка' }),
      previewAvailability: vi.fn().mockResolvedValue({
        lines: [availabilityLine({ index: 0, skuId: 'sku-1', requestedQuantity: 3, stockQuantity: 7, availableQuantity: 7 })],
      }),
    };
    const prisma = {
      barcode: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-1',
            value: '460000000001',
            sku: { id: 'sku-1', internalSku: 'BAR-001', name: 'Товар 1' },
          },
        ]),
      },
    };
    const service = new ClientRequestXlsxService(prisma as never, new ClientScopeService(), clientRequests as never);
    const authUser = user({ writableClientIds: ['client-1'], clientIds: ['client-1'] });

    const brokenRussianFileName = Buffer.from('Тест заявки.xlsx', 'utf8').toString('latin1');
    const result = await service.createOutboundRequest(
      fileFixture([['barcode', 'qty'], ['460000000001', 3]], brokenRussianFileName),
      { clientId: 'client-1', title: 'Excel сборка', priority: ClientRequestPriority.HIGH, destinationCity: 'Казань' },
      authUser,
    );

    expect(result.request).toEqual({ id: 'request-1', title: 'Excel сборка' });
    expect(clientRequests.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        type: 'OUTBOUND',
        priority: ClientRequestPriority.HIGH,
        title: 'Excel сборка',
        destinationCity: 'Казань',
        items: [
          expect.objectContaining({
            skuId: 'sku-1',
            barcode: '460000000001',
            name: 'Товар 1',
            quantity: 3,
          }),
        ],
      }),
      authUser,
    );
    expect(clientRequests.create.mock.calls[0][0].comment).toContain('Создано из Excel: Тест заявки.xlsx.');
  });

  it('распознает SKU по наименованию товара без баркода', async () => {
    const prisma = {
      barcode: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-1',
            internalSku: 'Костюм_реглан_синий',
            clientSku: null,
            article: null,
            name: 'Костюм реглан синий',
            needsRelabel: false,
          },
        ]),
      },
    };
    const service = new ClientRequestXlsxService(
      prisma as never,
      new ClientScopeService(),
      {
        create: vi.fn(),
        previewAvailability: vi.fn().mockResolvedValue({
          lines: [availabilityLine({ index: 0, skuId: 'sku-1', requestedQuantity: 10, stockQuantity: 12, availableQuantity: 12 })],
        }),
      } as never,
    );

    const preview = await service.previewOutboundRequest(
      fileFixture([
        ['Артикул продавца', 'Электросталь'],
        ['Костюм_реглан_синий', 10],
      ]),
      { clientId: 'client-1', title: 'Excel сборка', destinationCity: 'Казань' },
      user({ writableClientIds: ['client-1'], clientIds: ['client-1'] }),
    );

    expect(preview.issues).toEqual([]);
    expect(preview.canCommit).toBe(true);
    expect(preview.lines[0]).toMatchObject({
      skuId: 'sku-1',
      originalName: 'Костюм_реглан_синий',
      artSeller: 'Костюм_реглан_синий',
      city: 'Электросталь',
      requestedQuantity: 10,
      availableQuantity: 12,
    });
  });

  it('учитывает размер одежды при сопоставлении SKU по наименованию', async () => {
    const prisma = {
      barcode: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-s',
            internalSku: 'Костюм_реглан_синий',
            clientSku: null,
            article: null,
            name: 'Костюм реглан синий',
            size: 'S',
            needsRelabel: false,
          },
          {
            id: 'sku-l',
            internalSku: 'Костюм_реглан_синий',
            clientSku: null,
            article: null,
            name: 'Костюм реглан синий',
            size: 'L',
            needsRelabel: false,
          },
        ]),
      },
    };
    const previewAvailability = vi.fn().mockResolvedValue({
      lines: [availabilityLine({ index: 0, skuId: 'sku-l', requestedQuantity: 4, stockQuantity: 8, availableQuantity: 8 })],
    });
    const service = new ClientRequestXlsxService(
      prisma as never,
      new ClientScopeService(),
      {
        create: vi.fn(),
        previewAvailability,
      } as never,
    );

    const preview = await service.previewOutboundRequest(
      fileFixture([
        ['Наименование товара', 'Размер', 'Количество'],
        ['Костюм_реглан_синий', 'L', 4],
      ]),
      { clientId: 'client-1', title: 'Excel сборка', destinationCity: 'Казань' },
      user({ writableClientIds: ['client-1'], clientIds: ['client-1'] }),
    );

    expect(preview.issues).toEqual([]);
    expect(preview.lines[0]).toMatchObject({ skuId: 'sku-l', size: 'L', requestedQuantity: 4 });
    expect(previewAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ skuId: 'sku-l', quantity: 4 })],
      }),
      expect.anything(),
    );
  });

  it('проверяет, что баркод и наименование относятся к одному SKU', async () => {
    const prisma = {
      barcode: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-barcode',
            value: '460000000001',
            sku: {
              id: 'sku-barcode',
              internalSku: 'SKU-BARCODE',
              name: 'Товар по баркоду',
              needsRelabel: false,
            },
          },
        ]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-name',
            internalSku: 'Костюм_реглан_синий',
            clientSku: null,
            article: null,
            name: 'Костюм реглан синий',
            needsRelabel: false,
          },
        ]),
      },
    };
    const service = new ClientRequestXlsxService(
      prisma as never,
      new ClientScopeService(),
      {
        create: vi.fn(),
        previewAvailability: vi.fn().mockResolvedValue({
          lines: [availabilityLine({ index: 0, skuId: 'sku-barcode', requestedQuantity: 2, stockQuantity: 5, availableQuantity: 5 })],
        }),
      } as never,
    );

    const preview = await service.previewOutboundRequest(
      fileFixture([
        ['Баркод', 'Артикул продавца', 'Количество'],
        ['460000000001', 'Костюм_реглан_синий', 2],
      ]),
      { clientId: 'client-1', title: 'Excel сборка', destinationCity: 'Казань' },
      user({ writableClientIds: ['client-1'], clientIds: ['client-1'] }),
    );

    expect(preview.canCommit).toBe(false);
    expect(preview.issues).toContainEqual(
      expect.objectContaining({
        barcode: '460000000001',
        severity: 'error',
        message: 'Баркод и наименование товара относятся к разным SKU клиента.',
      }),
    );
  });

  it('предлагает переклейку из каталога клиента, если нужного баркода нет в остатках', async () => {
    const prisma = {
      barcode: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sku-source',
            internalSku: 'SRC-001',
            clientSku: null,
            article: null,
            name: 'Костюм реглан синий',
            size: 'L',
            needsRelabel: false,
            barcodes: [{ value: '111', isPrimary: true }],
          },
        ]),
      },
      stockBalance: {
        groupBy: vi.fn().mockResolvedValue([{ skuId: 'sku-source', _sum: { quantity: 8 } }]),
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-source',
            quantity: 8,
            sku: {
              id: 'sku-source',
              internalSku: 'SRC-001',
              clientSku: null,
              article: 'ART-1',
              name: 'Костюм реглан синий',
              size: 'L',
              barcodes: [{ value: '111', isPrimary: true }],
            },
          },
        ]),
      },
    };
    const service = new ClientRequestXlsxService(
      prisma as never,
      new ClientScopeService(),
      {
        create: vi.fn(),
        previewAvailability: vi.fn().mockResolvedValue({
          lines: [availabilityLine({ index: 0, skuId: '', requestedQuantity: 4, stockQuantity: 0, availableQuantity: 0 })],
        }),
      } as never,
    );

    const preview = await service.previewOutboundRequest(
      fileFixture([
        ['Баркод', 'Наименование товара', 'Размер', 'Количество'],
        ['222', 'Костюм реглан синий', 'L', 4],
      ]),
      { clientId: 'client-1', title: 'Excel сборка', destinationCity: 'Казань' },
      user({ writableClientIds: ['client-1'], clientIds: ['client-1'] }),
    );

    expect(preview.canCommit).toBe(false);
    expect(preview.relabelSourceOptions).toEqual([
      expect.objectContaining({
        skuId: 'sku-source',
        internalSku: 'SRC-001',
        barcode: '111',
        availableQuantity: 8,
      }),
    ]);
    expect(preview.lines[0].actionSuggestions).toEqual([
      expect.objectContaining({
        type: 'RELABEL',
        sourceSkuId: 'sku-source',
        sourceBarcode: '111',
        targetBarcode: '222',
        availableQuantity: 8,
        quantity: 4,
      }),
    ]);
  });
});

function fileFixture(rows: unknown[][], originalname = 'request.xlsx'): Express.Multer.File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
    stream: undefined as never,
    destination: '',
    filename: originalname,
    path: '',
  };
}

function availabilityLine(overrides: {
  index: number;
  skuId: string;
  requestedQuantity: number;
  stockQuantity: number;
  reservedQuantity?: number;
  availableQuantity: number;
  conflicts?: Array<{
    requestId: string;
    title: string;
    type: 'OUTBOUND';
    status: 'IN_WORK';
    createdAt: string;
    desiredDate: string | null;
    quantity: number;
  }>;
}) {
  const shortageQuantity = Math.max(0, overrides.requestedQuantity - overrides.availableQuantity);

  return {
    index: overrides.index,
    skuId: overrides.skuId,
    internalSku: null,
    name: null,
    barcode: null,
    requestedQuantity: overrides.requestedQuantity,
    stockQuantity: overrides.stockQuantity,
    reservedQuantity: overrides.reservedQuantity ?? 0,
    availableQuantity: overrides.availableQuantity,
    shortageQuantity,
    canFulfill: shortageQuantity === 0,
    conflicts: overrides.conflicts ?? [],
  };
}

function user(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    roleCodes: ['CLIENT'],
    permissionCodes: ['client-requests:read', 'client-requests:write'],
    clientScopeMode: 'LIMITED',
    clientIds: [],
    writableClientIds: [],
    ...overrides,
  };
}
