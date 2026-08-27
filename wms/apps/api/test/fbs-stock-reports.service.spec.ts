import { ClientRequestStatus, ClientRequestType, MarketplaceType, StockStatus } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { FbsStockReportsService } from '../src/modules/turnover/fbs-stock-reports.service';

const user: AuthUser = {
  id: 'user-1',
  email: 'manager@example.test',
  name: 'Менеджер',
  roleCodes: ['MANAGER'],
  permissionCodes: ['stock:read'],
  clientScopeMode: 'LIMITED',
  clientIds: ['client-1'],
  writableClientIds: [],
};

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('FBS stock reports', () => {
  // TEST: one marketplace order is counted once even when its quantity is
  // greater than one; cancelled, active and out-of-period rows stay excluded.
  it('counts unique actually shipped FBS orders by the DONE event date', async () => {
    const prisma = reportPrismaMock();
    const service = new FbsStockReportsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );

    const report = await service.shipments({
      clientId: 'client-1',
      dateFrom: '2026-08-20',
      dateTo: '2026-08-21',
      page: 1,
      pageSize: 20,
    }, user);

    expect(report.summary).toEqual({ orders: 2, units: 4 });
    expect(report.daily).toEqual([
      { date: '2026-08-20', orders: 1, units: 3 },
      { date: '2026-08-21', orders: 1, units: 1 },
    ]);
    expect(report.items.map((item) => item.orderId)).toEqual(['WB-1', 'OZON-2']);
    expect(report.items[0].units).toBe(3);
    expect(report.items.every((item) => !['ACTIVE', 'CANCELLED', 'OLD'].includes(item.orderId))).toBe(true);
  });

  // TEST: one box can only belong to the unplaced or pallet-sort group; units
  // are summed, repeated status rows are merged, and totals are not row counts.
  it('builds mutually exclusive current box and pallet-sort totals', async () => {
    const prisma = reportPrismaMock();
    const service = new FbsStockReportsService(
      prisma as never,
      { requireClientAccess: vi.fn() } as never,
    );

    const report = await service.boxes({
      clientId: 'client-1',
      page: 1,
      pageSize: 50,
      palletPage: 1,
      palletPageSize: 50,
    }, user);

    expect(report.withoutPallet.summary).toEqual({ boxes: 1, units: 5, rows: 2 });
    expect(report.withoutPallet.items).toEqual([
      expect.objectContaining({ boxCode: 'BOX-1', barcode: 'BAR-1', quantity: 3, boxTotal: 5 }),
      expect.objectContaining({ boxCode: 'BOX-1', barcode: 'BAR-2', quantity: 2, boxTotal: 5 }),
    ]);
    expect(report.onPallet.summary).toEqual({ boxes: 1, units: 4, barcodes: 1, pallets: 1 });
    expect(report.onPallet.items).toEqual([
      expect.objectContaining({ palletCode: 'PALLET-1', barcode: 'BAR-1', quantity: 4, boxes: 1 }),
    ]);
    expect(report.withoutPallet.items.some((row) => row.boxCode === 'BOX-2')).toBe(false);
  });

  // TEST: summary and full-period XLSX are independent from the selected UI page.
  it('keeps all orders in totals and Excel when the browser opens page two', async () => {
    const prisma = reportPrismaMock();
    const events = Array.from({ length: 12 }, (_, index) => shipmentEvent(
      `event-${String(index).padStart(2, '0')}`,
      `2026-08-20T${String(index).padStart(2, '0')}:00:00.000Z`,
      `request-${index}`,
      [link(`ORDER-${index}`, MarketplaceType.WILDBERRIES, 'shipped', 1)],
    ));
    prisma.clientRequestEvent.findMany.mockReset().mockResolvedValueOnce(events).mockResolvedValueOnce([]);
    const service = new FbsStockReportsService(prisma as never, { requireClientAccess: vi.fn() } as never);
    const filter = { clientId: 'client-1', dateFrom: '2026-08-20', dateTo: '2026-08-21', page: 2, pageSize: 10 };

    const report = await service.shipments(filter, user);
    expect(report.summary).toEqual({ orders: 12, units: 12 });
    expect(report.items).toHaveLength(2);

    prisma.clientRequestEvent.findMany.mockReset().mockResolvedValueOnce(events).mockResolvedValueOnce([]);
    const file = await service.exportShipments(filter, user);
    cleanups.push(file.cleanup);
    expect(file.rowCount).toBe(12);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file.filePath);
    expect(workbook.getWorksheet('Отгруженные FBS-заказы')?.rowCount).toBe(13);
  });

  // TEST: changing the real StoragePalletBox relation moves a box between the
  // groups without changing its units or counting it twice.
  it('moves a box from unplaced to pallet-sort after its placement changes', async () => {
    let placement: unknown = null;
    const prisma = reportPrismaMock();
    prisma.box.findMany.mockReset().mockImplementation(() => Promise.resolve([
      box('moving-box', 'BOX-MOVE', placement, [balance('sku-1', 'BAR-1', 3, StockStatus.AVAILABLE)]),
    ]));
    const service = new FbsStockReportsService(prisma as never, { requireClientAccess: vi.fn() } as never);

    const before = await service.boxes({ clientId: 'client-1', page: 1, pageSize: 50, palletPage: 1, palletPageSize: 50 }, user);
    expect(before.withoutPallet.summary).toMatchObject({ boxes: 1, units: 3 });
    expect(before.onPallet.summary).toMatchObject({ boxes: 0, units: 0 });

    placement = { pallet: { id: 'pallet-1', code: 'PALLET-1', status: 'CLOSED' } };
    const after = await service.boxes({ clientId: 'client-1', page: 1, pageSize: 50, palletPage: 1, palletPageSize: 50 }, user);
    expect(after.withoutPallet.summary).toMatchObject({ boxes: 0, units: 0 });
    expect(after.onPallet.summary).toMatchObject({ boxes: 1, units: 3 });
  });

  // TEST: box reads stay bounded and totals span every database batch.
  it('processes more than one 500-box batch without losing totals', async () => {
    const prisma = reportPrismaMock();
    const first = Array.from({ length: 500 }, (_, index) => box(
      `box-${index}`,
      `BOX-${index}`,
      null,
      [balance('sku-1', 'BAR-1', 1, StockStatus.AVAILABLE)],
    ));
    const last = box('box-500', 'BOX-500', null, [balance('sku-1', 'BAR-1', 2, StockStatus.AVAILABLE)]);
    prisma.box.findMany.mockReset().mockResolvedValueOnce(first).mockResolvedValueOnce([last]);
    const service = new FbsStockReportsService(prisma as never, { requireClientAccess: vi.fn() } as never);

    const report = await service.boxes({ clientId: 'client-1', page: 1, pageSize: 50, palletPage: 1, palletPageSize: 50 }, user);
    expect(report.withoutPallet.summary).toEqual({ boxes: 501, units: 502, rows: 501 });
    expect(prisma.box.findMany).toHaveBeenCalledTimes(2);
  });
});

function reportPrismaMock() {
  const events = [
    shipmentEvent('event-1', '2026-08-20T09:00:00.000Z', 'request-1', [
      link('WB-1', MarketplaceType.WILDBERRIES, 'shipped', 3),
      link('ACTIVE', MarketplaceType.WILDBERRIES, 'active', 1),
      link('CANCELLED', MarketplaceType.WILDBERRIES, 'cancelled', 1),
    ]),
    shipmentEvent('event-2', '2026-08-21T12:00:00.000Z', 'request-2', [
      link('OZON-2', MarketplaceType.OZON, 'archive', 1),
    ]),
    shipmentEvent('event-old', '2026-08-19T12:00:00.000Z', 'request-old', [
      link('OLD', MarketplaceType.WILDBERRIES, 'shipped', 1),
    ]),
  ];
  let eventRead = 0;
  let boxRead = 0;

  return {
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'CLIENT', name: 'Клиент' }) },
    warehouse: { findMany: vi.fn().mockResolvedValue([{ id: 'warehouse-1', code: 'MSK', name: 'Москва', city: 'Москва' }]) },
    clientRequestEvent: {
      findMany: vi.fn().mockImplementation(() => Promise.resolve(eventRead++ === 0 ? events : [])),
    },
    box: {
      findMany: vi.fn().mockImplementation(() => Promise.resolve(boxRead++ === 0 ? [
        box('box-1', 'BOX-1', null, [
          balance('sku-1', 'BAR-1', 2, StockStatus.AVAILABLE),
          balance('sku-1', 'BAR-1', 1, StockStatus.PACKING),
          balance('sku-2', 'BAR-2', 2, StockStatus.AVAILABLE),
        ]),
        box('box-2', 'BOX-2', { pallet: { id: 'pallet-1', code: 'PALLET-1', status: 'CLOSED' } }, [
          balance('sku-1', 'BAR-1', 4, StockStatus.AVAILABLE),
        ]),
      ] : [])),
    },
  };
}

function shipmentEvent(id: string, createdAt: string, requestId: string, links: ReturnType<typeof link>[]) {
  return {
    id,
    createdAt: new Date(createdAt),
    requestId,
    request: {
      id: requestId,
      number: requestId === 'request-1' ? 101 : 102,
      type: ClientRequestType.OUTBOUND,
      status: ClientRequestStatus.DONE,
      warehouseId: 'warehouse-1',
      warehouse: { id: 'warehouse-1', code: 'MSK', name: 'Москва', city: 'Москва' },
      fbsOrderLinks: links,
    },
  };
}

function link(orderId: string, marketplace: MarketplaceType, lastCategory: string, lastItemCount: number) {
  return { connectionId: 'connection-1', orderId, marketplace, lastCategory, lastItemCount };
}

function box(id: string, code: string, storagePlacement: unknown, balances: ReturnType<typeof balance>[]) {
  return {
    id,
    code,
    status: 'active',
    warehouse: { id: 'warehouse-1', code: 'MSK', name: 'Москва', city: 'Москва' },
    zone: { id: 'zone-1', code: 'A', name: 'Основная' },
    storagePlacement,
    balances,
  };
}

function balance(skuId: string, barcode: string, quantity: number, status: StockStatus) {
  return {
    skuId,
    quantity,
    status,
    sku: {
      id: skuId,
      article: `ART-${skuId}`,
      name: `Товар ${skuId}`,
      barcodes: [{ value: barcode, isPrimary: true }],
    },
  };
}

