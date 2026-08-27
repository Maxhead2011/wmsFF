import {
  ClientRequestStatus,
  ExpenseMaterialMovementType,
  ExpenseSource,
  Prisma,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ExpenseAutomationService } from '../src/modules/expenses/expense-automation.service';

const user = {
  id: 'user-1',
  email: 'owner@logoff.pro',
  name: 'Владелец',
  role: 'OWNER',
  clientId: null,
  permissions: ['system:admin'],
  isDemo: false,
};

function requestWithRule(chargeSeparately = true) {
  return {
    id: 'request-1',
    number: 17,
    title: 'Отгрузка FBS',
    clientId: 'client-1',
    status: ClientRequestStatus.DONE,
    updatedAt: new Date('2026-07-27T10:00:00.000Z'),
    items: [{ quantity: 3 }, { quantity: 2 }],
    client: {
      expenseMaterialRules: [
        {
          id: 'rule-1',
          materialId: 'material-1',
          quantityPerShippedUnit: new Prisma.Decimal('2'),
          chargeSeparately,
          billingUnitPriceRub: chargeSeparately
            ? new Prisma.Decimal('5')
            : null,
          material: {
            id: 'material-1',
            name: 'Курьерский пакет 17×21',
          },
        },
      ],
    },
  };
}

describe('ExpenseAutomationService', () => {
  it('один раз списывает материал и отдельно начисляет его клиенту', async () => {
    const tx = {
      expenseMaterialMovement: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'move-1' }),
      },
      expenseMaterial: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'material-1',
          code: 'PACK-17-21',
          name: 'Курьерский пакет 17×21',
          unit: 'шт.',
          stockQuantity: new Prisma.Decimal('4'),
          averageUnitCostRub: new Prisma.Decimal('3'),
          isActive: true,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      expenseEntry: {
        create: vi.fn().mockResolvedValue({ id: 'expense-1' }),
      },
      billingCharge: {
        create: vi.fn().mockResolvedValue({ id: 'charge-1' }),
      },
    };
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(requestWithRule(true)),
      },
      $transaction: vi.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };

    const service = new ExpenseAutomationService(prisma as never);
    const result = await service.consumeForDoneRequest('request-1', user as never);

    expect(result).toEqual({
      status: 'APPLIED',
      shippedUnits: 5,
      consumedMaterials: 1,
      billingCharges: 1,
      shortages: [
        {
          materialId: 'material-1',
          materialName: 'Курьерский пакет 17×21',
          stockQuantity: -6,
          shortageQuantity: 6,
          unit: 'шт.',
        },
      ],
    });
    expect(tx.expenseEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: ExpenseSource.AUTO_MATERIAL_CONSUMPTION,
        amountRub: new Prisma.Decimal('30.00'),
        quantity: new Prisma.Decimal('10.000'),
        sourceKey: 'request-material:request-1:rule-1',
      }),
    });
    expect(tx.expenseMaterialMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: ExpenseMaterialMovementType.CONSUMPTION,
        quantity: new Prisma.Decimal('-10.000'),
      }),
    });
    expect(tx.expenseMaterial.update).toHaveBeenCalledWith({
      where: { id: 'material-1' },
      data: { stockQuantity: new Prisma.Decimal('-6.000') },
    });
    expect(tx.billingCharge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quantity: new Prisma.Decimal('10.000'),
        unitPriceRub: new Prisma.Decimal('5.00'),
        totalRub: new Prisma.Decimal('50.00'),
        sourceKey: 'expense-material-charge:request-1:rule-1',
      }),
    });
  });

  it('не создаёт повторное списание при повторном закрытии той же заявки', async () => {
    const tx = {
      expenseMaterialMovement: {
        findUnique: vi.fn().mockResolvedValue({ id: 'move-existing' }),
      },
    };
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(requestWithRule(false)),
      },
      $transaction: vi.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };

    const service = new ExpenseAutomationService(prisma as never);
    const result = await service.consumeForDoneRequest('request-1', user as never);

    expect(result).toEqual({
      status: 'APPLIED',
      shippedUnits: 5,
      consumedMaterials: 0,
      billingCharges: 0,
      shortages: [],
    });
  });
});
