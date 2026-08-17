import 'reflect-metadata';
import { MovementType, StockStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { TurnoverActionKind } from '../src/modules/turnover/dto/turnover-action.dto';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

function setup(markCount = 0) {
  const sourceSku = {
    id: 'sku-wrong',
    name: 'Ошибочный товар',
    barcodes: [{ value: '111', isPrimary: true }],
  };
  const targetSku = {
    id: 'sku-correct',
    name: 'Правильный товар',
    barcodes: [{ value: '222', isPrimary: true }],
  };
  const tx = {
    stockMovement: {
      findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    sku: {
      findFirst: vi.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.id === sourceSku.id ? sourceSku : where.barcodes ? targetSku : null),
      ),
    },
    stockBalance: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'balance-1',
        warehouseId: 'warehouse-1',
        clientId: 'client-1',
        skuId: sourceSku.id,
        boxId: 'box-1',
        palletId: null,
        status: StockStatus.AVAILABLE,
        quantity: 3,
        box: { id: 'box-1', code: 'FFL_BOX_1', warehouseId: 'warehouse-1' },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({ id: 'balance-2', quantity: 2 }),
    },
    productMark: {
      count: vi.fn().mockResolvedValue(markCount),
    },
  };
  const prisma = {
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const clientScopes = {
    requireClientAccess: vi.fn(),
  };
  const service = new TurnoverService(prisma as never, clientScopes as never);
  const dto = {
    clientId: 'client-1',
    skuId: sourceSku.id,
    action: TurnoverActionKind.REPLACE_BARCODE,
    quantity: 2,
    sourceBoxCode: 'FFL_BOX_1',
    sourceBalanceId: 'balance-1',
    targetBarcode: '222',
    reason: 'Ошибочный ШК при приемке',
    idempotencyKey: 'barcode-fix-1',
  };

  return { service, tx, dto };
}

describe('TurnoverService: исправление ошибочного ШК', () => {
  it('атомарно переносит количество на правильный SKU в том же коробе и пишет парную историю', async () => {
    const { service, tx, dto } = setup();

    const result = await service.runAction(dto, {
      id: 'admin-1',
      name: 'Администратор',
      roleCodes: ['CLIENT'],
    } as never);

    expect(tx.stockBalance.updateMany).toHaveBeenCalledWith({
      where: { id: 'balance-1', quantity: { gte: 2 } },
      data: { quantity: { decrement: 2 } },
    });
    expect(tx.stockBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        skuId: 'sku-correct',
        boxId: 'box-1',
        status: StockStatus.AVAILABLE,
        quantity: 2,
      }),
    }));
    expect(tx.stockMovement.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ skuId: 'sku-wrong', type: MovementType.INVENTORY_ADJUSTMENT, quantity: -2 }),
        expect.objectContaining({ skuId: 'sku-correct', type: MovementType.INVENTORY_ADJUSTMENT, quantity: 2 }),
      ],
    });
    expect(result).toMatchObject({ status: 'APPLIED', skuId: 'sku-correct', quantity: 2, targetBoxCode: 'FFL_BOX_1' });
  });

  it('не меняет остаток, если в строке есть КИЗ', async () => {
    const { service, tx, dto } = setup(1);

    await expect(service.runAction(dto, {
      id: 'admin-1',
      name: 'Администратор',
      roleCodes: ['CLIENT'],
    } as never)).rejects.toThrow('есть КИЗы');

    expect(tx.stockBalance.updateMany).not.toHaveBeenCalled();
    expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
  });
});
