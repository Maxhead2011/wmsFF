import { BadRequestException } from '@nestjs/common';
import { ClientRequestPriority, ClientRequestStatus, ClientRequestType, StockStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { PickInstructionService } from '../src/modules/stock/pick-instruction.service';

describe('PickInstructionService', () => {
  it('строит план отбора по коробам без движения остатков', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(requestFixture()),
        findMany: vi.fn().mockResolvedValue([]),
      },
      barcode: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      clientArticleMapping: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          balanceFixture({ id: 'balance-1', boxId: 'box-1', boxCode: 'BOX-1', quantity: 2 }),
          balanceFixture({ id: 'balance-2', boxId: 'box-2', boxCode: 'BOX-2', quantity: 5 }),
        ]),
        groupBy: vi.fn().mockResolvedValue([
          { boxId: 'box-1', _sum: { quantity: 2 } },
          { boxId: 'box-2', _sum: { quantity: 5 } },
        ]),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new PickInstructionService(prisma as never, new ClientScopeService());

    const document = await service.getRequestInstruction('request-1', user({ clientIds: ['client-1'] }));

    expect(document.totalRequested).toBe(4);
    expect(document.totalAllocated).toBe(4);
    expect(document.totalShortage).toBe(0);
    expect(document.rows[0]).toMatchObject({
      status: 'READY',
      allocatedQuantity: 4,
      shortageQuantity: 0,
      allocations: [
        { balanceId: 'balance-1', boxCode: 'BOX-1', quantity: 2 },
        { balanceId: 'balance-2', boxCode: 'BOX-2', quantity: 2 },
      ],
    });
    expect(document.boxes).toEqual([
      expect.objectContaining({ boxCode: 'BOX-1', allocatedQuantity: 2, availableQuantity: 2, isFullBox: true }),
      expect.objectContaining({ boxCode: 'BOX-2', allocatedQuantity: 2, availableQuantity: 5, isFullBox: false }),
    ]);
    expect(document.warehouseBalanceMoves).toEqual([
      expect.objectContaining({ sourceBox: 'BOX-2', quantity: 2, purpose: 'SHIPMENT' }),
    ]);
    expect(document.html).toContain('Инструкция сборки');
  });

  it('показывает дефицит, если доступного остатка не хватает', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(requestFixture({ quantity: 6 })),
        findMany: vi.fn().mockResolvedValue([]),
      },
      barcode: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      clientArticleMapping: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          balanceFixture({ id: 'balance-1', boxId: 'box-1', boxCode: 'BOX-1', quantity: 2 }),
        ]),
        groupBy: vi.fn().mockResolvedValue([{ boxId: 'box-1', _sum: { quantity: 2 } }]),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new PickInstructionService(prisma as never, new ClientScopeService());

    const document = await service.getRequestInstruction('request-1', user({ clientIds: ['client-1'] }));

    expect(document.totalAllocated).toBe(2);
    expect(document.totalShortage).toBe(4);
    expect(document.rows[0]).toMatchObject({
      status: 'SHORTAGE',
      statusLabel: 'Дефицит',
      comment: 'Не хватает 4 шт. в AVAILABLE.',
    });

    const file = await service.getRequestInstructionXlsx('request-1', user({ clientIds: ['client-1'] }));
    const workbook = XLSX.read(file.content, { type: 'buffer' });
    const exportedRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[1]], {
      header: 1,
      defval: '',
    });
    expect(exportedRows).toHaveLength(2);
    expect(exportedRows[1][1]).toBe('BOX-1');
    expect(exportedRows.flat().join(' ')).not.toContain('нет на складе');
  });

  it('экспортирует складскую инструкцию в XLSX', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(requestFixture()),
        findMany: vi.fn().mockResolvedValue([]),
      },
      barcode: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      clientArticleMapping: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          balanceFixture({ id: 'balance-1', boxId: 'box-1', boxCode: 'BOX-1', quantity: 2 }),
          balanceFixture({ id: 'balance-2', boxId: 'box-2', boxCode: 'BOX-2', quantity: 5 }),
        ]),
        groupBy: vi.fn().mockResolvedValue([
          { boxId: 'box-1', _sum: { quantity: 2 } },
          { boxId: 'box-2', _sum: { quantity: 5 } },
        ]),
      },
      box: {
        findMany: vi.fn().mockResolvedValue([{ code: balanceBoxCodeForToday(1) }]),
      },
    };
    const service = new PickInstructionService(prisma as never, new ClientScopeService());

    const file = await service.getRequestInstructionXlsx('request-1', user({ clientIds: ['client-1'] }));
    const workbook = XLSX.read(file.content, { type: 'buffer' });

    expect(file.fileName).toMatch(/\.xlsx$/);
    expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(workbook.SheetNames).toEqual(['Короба для поиска', 'Поиск коробов', 'Перемаркировка', 'Перемещения']);
    const searchBoxRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Короба для поиска'], { defval: '' });
    const instructionRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Поиск коробов'], { defval: '' });
    const markRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Перемаркировка'], { defval: '' });
    const moveRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Перемещения'], { defval: '' });

    expect(searchBoxRows).toEqual([{ Короб: 'BOX-1' }, { Короб: 'BOX-2' }]);
    expect(instructionRows[0]).toMatchObject({ 'Исходный короб': 'BOX-1', Количество: 2, Комментарий: 'ЦЕЛЫЙ' });
    expect(instructionRows[1]).toMatchObject({ 'Исходный короб': 'BOX-2', Количество: 2 });
    expect(Object.values(markRows[0])).toContain('Переклейки нет.');
    expect(moveRows[0]).toMatchObject({
      'Исходный короб': 'BOX-2',
      Количество: 2,
    });
  });

  it('планирует общий целый короб для двух городов без повторного перемещения', async () => {
    const prior = requestFixture({
      id: 'request-prior',
      quantity: 2,
      destinationCity: 'Екатеринбург',
      status: ClientRequestStatus.IN_WORK,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    });
    const current = requestFixture({
      id: 'request-current',
      quantity: 2,
      destinationCity: 'Краснодар',
      status: ClientRequestStatus.IN_WORK,
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
    });
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === prior.id ? prior : current),
        ),
        findMany: vi.fn().mockResolvedValue([prior, current]),
      },
      barcode: { findMany: vi.fn().mockResolvedValue([]) },
      clientArticleMapping: { findMany: vi.fn().mockResolvedValue([]) },
      sku: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([balanceFixture({ id: 'balance-1', boxId: 'box-1', boxCode: 'BOX-1', quantity: 4 })]),
        groupBy: vi.fn().mockResolvedValue([{ boxId: 'box-1', _sum: { quantity: 4 } }]),
      },
      box: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new PickInstructionService(prisma as never, new ClientScopeService());

    const document = await service.getRequestInstruction(current.id, user({ clientIds: ['client-1'] }));

    expect(document.boxes).toEqual([
      expect.objectContaining({ boxCode: 'BOX-1', allocatedQuantity: 2 }),
    ]);
    expect(document.totalAllocated).toBe(2);
    expect(document.totalShortage).toBe(0);
    expect(document.warehouseWholeBoxes).toEqual([
      expect.objectContaining({ box: 'BOX-1', status: 'НЕСКОЛЬКО', city: 'РАЗНЫЕ ГОРОДА' }),
    ]);
    expect(document.warehouseBalanceMoves).toEqual([]);
    expect(document.warehouseRows[0].comment).toBe('НЕСКОЛЬКО');
  });

  it('не отправляет исходный короб при расходе ровно половины содержимого', async () => {
    const request = requestFixture({ quantity: 5 });
    const prisma = instructionPrisma(request, [
      balanceFixture({ id: 'balance-1', boxId: 'box-1', boxCode: 'BOX-1', quantity: 10 }),
    ]);
    const service = new PickInstructionService(prisma as never, new ClientScopeService());

    const document = await service.getRequestInstruction(request.id, user({ clientIds: ['client-1'] }));

    expect(document.warehouseWholeBoxes).toEqual([]);
    expect(document.warehouseRows[0].comment).toBe('ПОСТАВКА');
    expect(document.warehouseBalanceMoves).toEqual([
      expect.objectContaining({ sourceBox: 'BOX-1', quantity: 5, purpose: 'SHIPMENT' }),
    ]);
  });

  it('отправляет исходный короб и перекладывает остаток при расходе больше половины', async () => {
    const request = requestFixture({ quantity: 6 });
    const prisma = instructionPrisma(request, [
      balanceFixture({ id: 'balance-1', boxId: 'box-1', boxCode: 'BOX-1', quantity: 10 }),
    ]);
    const service = new PickInstructionService(prisma as never, new ClientScopeService());

    const document = await service.getRequestInstruction(request.id, user({ clientIds: ['client-1'] }));

    expect(document.warehouseRows[0].comment).toBe('ПОСТАВКА');
    expect(document.warehouseWholeBoxes).toEqual([
      expect.objectContaining({ box: 'BOX-1', status: 'КОРОБ УЕЗЖАЕТ, ОСТАТОК ПЕРЕЛОЖИТЬ' }),
    ]);
    expect(document.warehouseBalanceMoves).toEqual([
      expect.objectContaining({ sourceBox: 'BOX-1', quantity: 4, purpose: 'BALANCE' }),
    ]);
  });

  it('перемаркирует последним этапом и не увеличивает физическую потребность', async () => {
    const request = requestFixture({ quantity: 25 });
    const sourceSku = {
      ...request.items[0].sku,
      id: 'sku-source',
      internalSku: 'SOURCE',
      barcodes: [{ value: '2049156013678', isPrimary: true }],
    };
    request.items = [
      {
        ...request.items[0],
        id: 'item-source',
        skuId: sourceSku.id,
        barcode: '2049156013678',
        quantity: 25,
        sku: sourceSku,
      },
      {
        ...request.items[0],
        id: 'item-relabel',
        skuId: 'sku-target',
        barcode: '2051369340472',
        quantity: 15,
        comment: 'перемаркировка: да; перемаркировка из: 2049156013678; перемаркировка в: 2051369340472',
        sku: {
          ...request.items[0].sku,
          id: 'sku-target',
          internalSku: 'TARGET',
          barcodes: [{ value: '2051369340472', isPrimary: true }],
        },
      },
    ];
    const balance = balanceFixture({
      id: 'balance-1',
      boxId: 'box-1',
      boxCode: 'BOX-1',
      quantity: 40,
      skuId: sourceSku.id,
      sku: sourceSku,
    });
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(request),
        findMany: vi.fn().mockResolvedValue([request]),
      },
      barcode: { findMany: vi.fn().mockResolvedValue([]) },
      clientArticleMapping: { findMany: vi.fn().mockResolvedValue([]) },
      sku: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([balance]),
        groupBy: vi.fn().mockResolvedValue([{ boxId: 'box-1', _sum: { quantity: 40 } }]),
      },
      box: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new PickInstructionService(prisma as never, new ClientScopeService());

    const document = await service.getRequestInstruction(request.id, user({ clientIds: ['client-1'] }));

    expect(document.totalRequested).toBe(40);
    expect(document.totalAllocated).toBe(40);
    expect(document.totalShortage).toBe(0);
    expect(document.rows.map((row) => row.allocatedQuantity)).toEqual([25, 15]);
    expect(document.warehouseMarkRows.reduce((sum, row) => sum + row.quantity, 0)).toBe(15);
  });

  it('строит общую волну и выносит остаток задействованного короба на проверку клиента', async () => {
    const first = requestFixture({
      id: 'request-ekb',
      quantity: 3,
      destinationCity: 'Екатеринбург',
      status: ClientRequestStatus.IN_WORK,
      createdAt: new Date('2026-07-15T08:00:00.000Z'),
    });
    const second = requestFixture({
      id: 'request-krasnodar',
      quantity: 2,
      destinationCity: 'Краснодар',
      status: ClientRequestStatus.IN_WORK,
      createdAt: new Date('2026-07-15T08:01:00.000Z'),
    });
    const balance = balanceFixture({ id: 'balance-wave', boxId: 'box-wave', boxCode: 'FFL_WAVE_001', quantity: 8 });
    const prisma = {
      clientRequest: { findMany: vi.fn().mockResolvedValue([first, second]) },
      barcode: { findMany: vi.fn().mockResolvedValue([]) },
      clientArticleMapping: { findMany: vi.fn().mockResolvedValue([]) },
      sku: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: { findMany: vi.fn().mockResolvedValue([balance]) },
      box: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new PickInstructionService(prisma as never, new ClientScopeService());

    const draft = await service.buildWaveDraft(
      [first.id, second.id],
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(draft.plan.reservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: first.items[0].id, balanceId: balance.id, quantity: 3 }),
        expect.objectContaining({ orderId: second.items[0].id, balanceId: balance.id, quantity: 2 }),
      ]),
    );
    expect(draft.balanceLines).toEqual([
      expect.objectContaining({
        balanceId: balance.id,
        sourceBoxCode: 'FFL_WAVE_001',
        originalQuantity: 8,
        plannedQuantity: 5,
        remainingQuantity: 3,
      }),
    ]);
    // TEST: reservations are loaded only from the wave's selected physical branch.
    expect(prisma.stockBalance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ warehouseId: 'warehouse-1', clientId: 'client-1' }),
    }));
  });

  // TEST: same-client requests in different branches cannot share a warehouse plan.
  it('не строит общую волну для заявок разных филиалов', async () => {
    const prisma = {
      clientRequest: { findMany: vi.fn().mockResolvedValue([
        requestFixture({ id: 'request-1' }),
        requestFixture({ id: 'request-2', warehouseId: 'warehouse-2' }),
      ]) },
      stockBalance: { findMany: vi.fn() },
    };
    const service = new PickInstructionService(prisma as never, new ClientScopeService());
    await expect(service.buildWaveDraft(['request-1', 'request-2'], user({
      clientIds: ['client-1'], writableClientIds: ['client-1'],
    }))).rejects.toThrow('Все заявки волны должны относиться к одному выбранному филиалу.');
    expect(prisma.stockBalance.findMany).not.toHaveBeenCalled();
  });

  it('отклоняет инструкцию для не outbound-заявки', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(requestFixture({ type: ClientRequestType.INBOUND })),
      },
    };
    const service = new PickInstructionService(prisma as never, new ClientScopeService());

    await expect(service.getRequestInstruction('request-1', user({ clientIds: ['client-1'] }))).rejects.toThrow(BadRequestException);
  });

  it('принудительно пересчитывает активную заявку и исключает архивные короба', async () => {
    const request = requestFixture({ status: ClientRequestStatus.IN_WORK });
    const balance = balanceFixture({
      id: 'balance-current',
      boxId: 'box-current',
      boxCode: 'FFL_CURRENT_001',
      quantity: 4,
    });
    const eventCreate = vi.fn().mockResolvedValue({ id: 'event-refresh' });
    const stockBalanceFindMany = vi.fn().mockResolvedValue([balance]);
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(request),
        findMany: vi.fn().mockResolvedValue([request]),
      },
      clientRequestEvent: {
        create: eventCreate,
      },
      barcode: { findMany: vi.fn().mockResolvedValue([]) },
      clientArticleMapping: { findMany: vi.fn().mockResolvedValue([]) },
      sku: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: {
        findMany: stockBalanceFindMany,
        groupBy: vi.fn().mockResolvedValue([{ boxId: balance.boxId, _sum: { quantity: balance.quantity } }]),
      },
      box: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new PickInstructionService(prisma as never, new ClientScopeService());

    const document = await service.refreshRequestInstruction(
      request.id,
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: request.id,
        title: 'Принудительный пересчёт заявки по текущим остаткам',
      }),
    });
    expect(stockBalanceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          box: { status: { notIn: ['deleted', 'archived'] } },
        }),
      }),
    );
    expect(document.boxes).toEqual([
      expect.objectContaining({ boxCode: 'FFL_CURRENT_001', allocatedQuantity: 4 }),
    ]);
  });
});

function requestFixture(
  overrides: {
    quantity?: number;
    type?: ClientRequestType;
    status?: ClientRequestStatus;
    id?: string;
    createdAt?: Date;
    destinationCity?: string;
    warehouseId?: string;
  } = {},
) {
  const requestId = overrides.id ?? 'request-1';
  return {
    id: requestId,
    // TEST: request fixtures model the current branch-bound warehouse contract.
    warehouseId: overrides.warehouseId ?? 'warehouse-1',
    clientId: 'client-1',
    title: 'Excel сборка',
    type: overrides.type ?? ClientRequestType.OUTBOUND,
    status: overrides.status ?? ClientRequestStatus.SUBMITTED,
    priority: ClientRequestPriority.NORMAL,
    destinationCity: overrides.destinationCity ?? 'Казань',
    deliveryAddress: 'Москва',
    desiredDate: new Date('2026-06-30T00:00:00.000Z'),
    createdAt: overrides.createdAt ?? new Date('2026-06-20T00:00:00.000Z'),
    client: {
      id: 'client-1',
      code: 'CLIENT',
      name: 'Client',
    },
    items: [
      {
        id: `item-${requestId}`,
        skuId: 'sku-1',
        barcode: '460000000001',
        name: null,
        quantity: overrides.quantity ?? 4,
        comment: null,
        sku: {
          id: 'sku-1',
          clientId: 'client-1',
          internalSku: 'SKU-1',
          clientSku: null,
          article: null,
          name: 'Товар 1',
          brand: null,
          category: null,
          color: null,
          size: null,
          weightGrams: null,
          lengthCm: null,
          widthCm: null,
          heightCm: null,
          volumeLiters: null,
          volumeSource: 'MANUAL',
          needsChestnyZnak: false,
          isUnmarked: false,
          needsLabel: false,
          needsRelabel: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          barcodes: [{ value: '460000000001', isPrimary: true }],
        },
      },
    ],
  };
}

function balanceFixture(input: {
  id: string;
  boxId: string;
  boxCode: string;
  quantity: number;
  skuId?: string;
  sku?: ReturnType<typeof requestFixture>['items'][number]['sku'];
}) {
  return {
    id: input.id,
    balanceKey: `key-${input.id}`,
    warehouseId: 'warehouse-1',
    clientId: 'client-1',
    skuId: input.skuId ?? 'sku-1',
    boxId: input.boxId,
    palletId: 'pallet-1',
    status: StockStatus.AVAILABLE,
    quantity: input.quantity,
    updatedAt: new Date(),
    box: { id: input.boxId, code: input.boxCode },
    pallet: { id: 'pallet-1', code: 'PALLET-1' },
    sku: input.sku ?? requestFixture().items[0].sku,
  };
}

function instructionPrisma(
  request: ReturnType<typeof requestFixture>,
  balances: Array<ReturnType<typeof balanceFixture>>,
) {
  return {
    clientRequest: {
      findUnique: vi.fn().mockResolvedValue(request),
      findMany: vi.fn().mockResolvedValue([request]),
    },
    barcode: { findMany: vi.fn().mockResolvedValue([]) },
    clientArticleMapping: { findMany: vi.fn().mockResolvedValue([]) },
    sku: { findMany: vi.fn().mockResolvedValue([]) },
    stockBalance: {
      findMany: vi.fn().mockResolvedValue(balances),
      groupBy: vi.fn().mockResolvedValue(
        balances.map((balance) => ({ boxId: balance.boxId, _sum: { quantity: balance.quantity } })),
      ),
    },
    box: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

function user(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    roleCodes: ['MANAGER'],
    permissionCodes: ['stock:write'],
    activeWarehouseId: 'warehouse-1',
    warehouseIds: ['warehouse-1'],
    writableWarehouseIds: ['warehouse-1'],
    clientScopeMode: 'LIMITED',
    clientIds: [],
    writableClientIds: [],
    ...overrides,
  };
}

function balanceBoxCodeForToday(sequence: number) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  }).formatToParts(now);
  const day = parts.find((part) => part.type === 'day')?.value ?? String(now.getDate()).padStart(2, '0');
  const month = parts.find((part) => part.type === 'month')?.value ?? String(now.getMonth() + 1).padStart(2, '0');
  return `FFL_BAL${day}${month}_${String(sequence).padStart(2, '0')}`;
}
