import { NotFoundException } from '@nestjs/common';
import { ClientRequestStatus, PickWaveRequestStatus, PickWaveStatus, StockStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { PickWaveDocumentService } from '../src/modules/stock/pick-wave-document.service';

describe('PickWaveDocumentService', () => {
  it('строит печатный лист плановой волны с подсказкой доступного короба', async () => {
    const prisma = {
      pickWave: {
        findUnique: vi.fn().mockResolvedValue(waveFixture()),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'balance-1',
            warehouseId: 'warehouse-1',
            clientId: 'client-1',
            skuId: 'sku-1',
            boxId: 'box-1',
            palletId: 'pallet-1',
            status: StockStatus.AVAILABLE,
            quantity: 5,
            updatedAt: new Date('2026-06-26T09:00:00.000Z'),
            box: { id: 'box-1', code: 'BOX-A1', zone: { id: 'zone-1', code: 'A-01', name: 'Зона A' } },
            pallet: { id: 'pallet-1', code: 'PAL-01', zone: { id: 'zone-1', code: 'A-01', name: 'Зона A' } },
          },
        ]),
      },
      box: {
        findMany: vi.fn(),
      },
      pallet: {
        findMany: vi.fn(),
      },
    };
    const scopes = { requireClientAccess: vi.fn() };
    const service = new PickWaveDocumentService(prisma as never, scopes as never);

    const document = await service.getWaveDocument('wave-1', user());

    expect(scopes.requireClientAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'client-1', 'read');
    // TEST: a printable plan cannot allocate another branch's stock.
    expect(prisma.stockBalance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ warehouseId: 'warehouse-1' }),
    }));
    expect(document).toMatchObject({
      waveId: 'wave-1',
      waveNumber: 'WAVE-1',
      assignedPicker: {
        name: 'Сборщик',
      },
      rowsCount: 1,
      totalRequested: 3,
      totalPicked: 0,
    });
    expect(document.rows[0].allocations).toEqual([
      expect.objectContaining({
        boxCode: 'BOX-A1',
        palletCode: 'PAL-01',
        zoneCode: 'A-01',
        zoneName: 'Зона A',
        quantity: 3,
        source: 'planned',
      }),
    ]);
    expect(document.html).toContain('Лист сборки WAVE-1');
    expect(document.html).toContain('Сборщик');
    expect(document.html).toContain('A-01 · Зона A');
    expect(document.html).toContain('BOX-A1 / PAL-01');
  });

  it('показывает фактические аллокации после запуска волны', async () => {
    const prisma = {
      pickWave: {
        findUnique: vi.fn().mockResolvedValue(
          waveFixture({
            status: PickWaveStatus.DONE,
            linkStatus: PickWaveRequestStatus.PICKED,
            result: {
              status: 'APPLIED',
              pickedLines: [
                {
                  itemId: 'item-1',
                  skuId: 'sku-1',
                  requestedQuantity: 3,
                  pickedQuantity: 3,
                  allocations: [{ boxId: 'box-picked', palletId: 'pallet-picked', quantity: 3 }],
                },
              ],
            },
          }),
        ),
      },
      stockBalance: {
        findMany: vi.fn(),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([{ id: 'box-picked', code: 'BOX-DONE', zone: { id: 'zone-done', code: 'D-02', name: 'Готовая зона' } }]),
      },
      pallet: {
        findMany: vi.fn().mockResolvedValue([{ id: 'pallet-picked', code: 'PAL-DONE', zone: null }]),
      },
    };
    const service = new PickWaveDocumentService(prisma as never, { requireClientAccess: vi.fn() } as never);

    const document = await service.getWaveDocument('wave-1', user());

    expect(prisma.stockBalance.findMany).not.toHaveBeenCalled();
    expect(document.totalPicked).toBe(3);
    expect(document.rows[0].allocations).toEqual([
      expect.objectContaining({
        boxCode: 'BOX-DONE',
        palletCode: 'PAL-DONE',
        zoneCode: 'D-02',
        zoneName: 'Готовая зона',
        source: 'picked',
      }),
    ]);
    expect(document.html).toContain('D-02 · Готовая зона');
    expect(document.html).toContain('BOX-DONE / PAL-DONE');
  });

  it('экспортирует лист волны в XLSX', async () => {
    const prisma = {
      pickWave: {
        findUnique: vi.fn().mockResolvedValue(waveFixture()),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'balance-1',
            warehouseId: 'warehouse-1',
            clientId: 'client-1',
            skuId: 'sku-1',
            boxId: 'box-1',
            palletId: 'pallet-1',
            status: StockStatus.AVAILABLE,
            quantity: 5,
            updatedAt: new Date('2026-06-26T09:00:00.000Z'),
            box: { id: 'box-1', code: 'BOX-A1', zone: { id: 'zone-1', code: 'A-01', name: 'Зона A' } },
            pallet: { id: 'pallet-1', code: 'PAL-01', zone: { id: 'zone-1', code: 'A-01', name: 'Зона A' } },
          },
        ]),
      },
      box: {
        findMany: vi.fn(),
      },
      pallet: {
        findMany: vi.fn(),
      },
    };
    const service = new PickWaveDocumentService(prisma as never, { requireClientAccess: vi.fn() } as never);

    const file = await service.getWaveDocumentXlsx('wave-1', user());
    const workbook = XLSX.read(file.content, { type: 'buffer' });

    expect(file.fileName).toBe('pick-wave-WAVE-1.xlsx');
    expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(workbook.SheetNames).toEqual(['Сводка', 'Маршрут', 'Зоны', 'Короба', 'Проблемы']);
    const summaryRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Сводка'], { defval: '' });
    const routeRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Маршрут'], { defval: '' });
    const zoneRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Зоны'], { defval: '' });
    const boxRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Короба'], { defval: '' });

    expect(summaryRows).toContainEqual({ Параметр: 'Сборщик', Значение: 'Сборщик' });
    expect(routeRows[0]).toMatchObject({ Волна: 'WAVE-1', Заявка: 'Отгрузка', Зона: 'A-01 · Зона A', Взять: 3 });
    expect(zoneRows[0]).toMatchObject({ Зона: 'A-01 · Зона A', Количество: 3 });
    expect(boxRows[0]).toMatchObject({ Зона: 'A-01 · Зона A', Короб: 'BOX-A1', Паллета: 'PAL-01', Количество: 3 });
  });

  // TEST: reject mixed-branch data and cross-branch access before reading stock for print.
  it.each([
    { requestWarehouseId: 'warehouse-2', activeWarehouseId: 'warehouse-1', message: 'Волна содержит заявки разных филиалов или не привязана к филиалу.' },
    { requestWarehouseId: 'warehouse-1', activeWarehouseId: 'warehouse-2', message: 'Волна не найдена в выбранном филиале.' },
  ])('не печатает недоступную волну: $message', async ({ requestWarehouseId, activeWarehouseId, message }) => {
    const wave = waveFixture();
    wave.requests[0].request.warehouseId = requestWarehouseId;
    const prisma = {
      pickWave: { findUnique: vi.fn().mockResolvedValue(wave) },
      stockBalance: { findMany: vi.fn() }, box: { findMany: vi.fn() }, pallet: { findMany: vi.fn() },
    };
    const service = new PickWaveDocumentService(prisma as never, { requireClientAccess: vi.fn() } as never);
    await expect(service.getWaveDocument(wave.id, {
      ...user(), activeWarehouseId, warehouseIds: [activeWarehouseId], writableWarehouseIds: [activeWarehouseId],
    })).rejects.toThrow(message);
    expect(prisma.stockBalance.findMany).not.toHaveBeenCalled();
    expect(prisma.box.findMany).not.toHaveBeenCalled();
    expect(prisma.pallet.findMany).not.toHaveBeenCalled();
  });

  it('возвращает 404 для неизвестной волны', async () => {
    const service = new PickWaveDocumentService(
      { pickWave: { findUnique: vi.fn().mockResolvedValue(null) } } as never,
      { requireClientAccess: vi.fn() } as never,
    );

    await expect(service.getWaveDocument('missing', user())).rejects.toThrow(NotFoundException);
  });
});

function waveFixture(overrides: { status?: PickWaveStatus; linkStatus?: PickWaveRequestStatus; result?: unknown } = {}) {
  return {
    id: 'wave-1',
    warehouseId: 'warehouse-1',
    waveNumber: 'WAVE-1',
    status: overrides.status ?? PickWaveStatus.PLANNED,
    comment: 'Первая волна',
    createdAt: new Date('2026-06-26T09:00:00.000Z'),
    updatedAt: new Date('2026-06-26T09:10:00.000Z'),
    createdBy: {
      id: 'user-1',
      email: 'operator@example.com',
      name: 'Operator',
    },
    assignedPicker: {
      id: 'picker-1',
      email: 'picker@example.com',
      name: 'Сборщик',
    },
    requests: [
      {
        waveId: 'wave-1',
        requestId: 'request-1',
        status: overrides.linkStatus ?? PickWaveRequestStatus.PLANNED,
        result: overrides.result ?? null,
        pickedAt: null,
        request: {
          id: 'request-1',
          clientId: 'client-1',
          warehouseId: 'warehouse-1',
          title: 'Отгрузка',
          status: ClientRequestStatus.APPROVED,
          client: {
            code: 'CLIENT',
            name: 'Клиент',
          },
          items: [
            {
              id: 'item-1',
              requestId: 'request-1',
              skuId: 'sku-1',
              barcode: '4600000000000',
              name: 'Товар',
              quantity: 3,
              comment: null,
              sku: {
                id: 'sku-1',
                internalSku: 'SKU-1',
                name: 'Товар SKU',
              },
            },
          ],
        },
      },
    ],
  };
}

function user(): AuthUser {
  return {
    id: 'user-1',
    email: 'operator@example.com',
    name: 'Operator',
    roleCodes: ['OPERATOR'],
    permissionCodes: ['stock:write'],
    activeWarehouseId: 'warehouse-1',
    warehouseIds: ['warehouse-1'],
    writableWarehouseIds: ['warehouse-1'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };
}
