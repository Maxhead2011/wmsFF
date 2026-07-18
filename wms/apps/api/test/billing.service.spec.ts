import { BadRequestException } from '@nestjs/common';
import {
  BillingChargeSource,
  BillingChargeStatus,
  BillingInvoiceStatus,
  BillingUnit,
  ClientNotificationEvent,
  MovementType,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { BillingService } from '../src/modules/billing/billing.service';

describe('BillingService', () => {
  it('С„РёР»СЊС‚СЂСѓРµС‚ РЅР°С‡РёСЃР»РµРЅРёСЏ РїРѕ РґРѕСЃС‚СѓРїРЅС‹Рј РєР»РёРµРЅС‚Р°Рј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ', async () => {
    const prisma = {
      billingCharge: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.listCharges({}, user({ clientIds: ['client-1'] }));

    expect(prisma.billingCharge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: { in: ['client-1'] },
        }),
      }),
    );
  });

  it('СЃРѕР·РґР°РµС‚ РЅР°С‡РёСЃР»РµРЅРёРµ РїРѕ СѓСЃР»СѓРіРµ Рё СЃС‡РёС‚Р°РµС‚ СЃСѓРјРјСѓ', async () => {
    const prisma = {
      billingService: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'service-1',
          name: 'РџСЂРёРµРјРєР° РєРѕСЂРѕР±РѕРІ',
          unit: BillingUnit.BOX,
          defaultPriceRub: '12.50',
        }),
      },
      clientRequest: {
        findFirst: vi.fn().mockResolvedValue({ id: 'request-1' }),
      },
      billingCharge: {
        create: vi.fn().mockResolvedValue({ id: 'charge-1' }),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.createCharge(
      {
        clientId: 'client-1',
        serviceId: 'service-1',
        requestId: 'request-1',
        quantity: 4,
      },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(prisma.billingCharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          description: 'РџСЂРёРµРјРєР° РєРѕСЂРѕР±РѕРІ',
          unit: BillingUnit.BOX,
          unitPriceRub: 12.5,
          totalRub: 50,
          createdByUserId: 'user-1',
        }),
      }),
    );
  });

  it('Р·Р°РїСЂРµС‰Р°РµС‚ РїСЂРёРІСЏР·Р°С‚СЊ РЅР°С‡РёСЃР»РµРЅРёРµ Рє Р·Р°СЏРІРєРµ РґСЂСѓРіРѕРіРѕ РєР»РёРµРЅС‚Р°', async () => {
    const prisma = {
      billingService: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      clientRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await expect(
      service.createCharge(
        {
          clientId: 'client-1',
          requestId: 'foreign-request',
          description: 'Р СѓС‡РЅР°СЏ СѓСЃР»СѓРіР°',
          quantity: 1,
          unitPriceRub: 100,
        },
        user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('СЃРѕР·РґР°РµС‚ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРµ РЅР°С‡РёСЃР»РµРЅРёРµ С…СЂР°РЅРµРЅРёСЏ РїРѕ РёСЃС‚РѕСЂРёС‡РµСЃРєРѕРјСѓ ledger', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ storageAccountingEnabled: true, storagePriceRubPerLiterDay: '0.5' }),
      },
      billingService: {
        upsert: vi.fn().mockResolvedValue({
          id: 'service-storage',
          code: 'STORAGE_LITER_DAY',
          defaultPriceRub: null,
        }),
      },
      billingCharge: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'charge-storage' }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-1',
            type: MovementType.RECEIPT,
            status: 'AVAILABLE',
            quantity: 2,
            createdAt: new Date('2026-05-31T12:00:00.000Z'),
            sku: { id: 'sku-1', internalSku: 'SKU-1', name: 'РўРѕРІР°СЂ 1', volumeLiters: '1.500' },
          },
          {
            skuId: 'sku-2',
            type: MovementType.RECEIPT,
            status: 'AVAILABLE',
            quantity: 3,
            createdAt: new Date('2026-06-02T10:00:00.000Z'),
            sku: { id: 'sku-2', internalSku: 'SKU-2', name: 'РўРѕРІР°СЂ 2', volumeLiters: '2.000' },
          },
        ]),
      },
      stockBalance: {
        findMany: vi.fn(),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.generateStorageCharge(
      {
        clientId: 'client-1',
        periodFrom: '2026-06-01',
        periodTo: '2026-06-03',
        unitPriceRub: 0.5,
        approve: true,
      },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-1',
          createdAt: { lte: new Date('2026-06-03T23:59:59.999Z') },
        }),
      }),
    );
    expect(prisma.stockBalance.findMany).not.toHaveBeenCalled();
    expect(prisma.billingCharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          serviceId: 'service-storage',
          unit: BillingUnit.LITER_DAY,
          quantity: 15,
          unitPriceRub: 0.5,
          totalRub: 7.5,
          status: BillingChargeStatus.APPROVED,
          source: BillingChargeSource.STORAGE,
          sourceKey: 'storage:client-1:2026-06-01:2026-06-03',
          approvedByUserId: 'user-1',
          metadata: expect.objectContaining({
            calculationMode: 'LEDGER',
            days: 3,
            totalLiters: 5,
            literDays: 15,
            balancesCount: 2,
            skippedWithoutVolume: 0,
            daily: [
              { date: '2026-06-01', totalLiters: 3, literDays: 3, positions: 1 },
              { date: '2026-06-02', totalLiters: 3, literDays: 3, positions: 1 },
              { date: '2026-06-03', totalLiters: 9, literDays: 9, positions: 2 },
            ],
          }),
        }),
      }),
    );
  });

  it('hides invoices of demo clients from administrators', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { billingInvoice: { findMany } };
    const service = new BillingService(prisma as never, clientScopes());

    await service.listInvoices(
      {},
      user({
        roleCodes: ['ADMIN'],
        permissionCodes: ['system:admin', 'billing:read'],
        clientScopeMode: 'ALL',
      }),
    );

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        client: { isDemo: false },
      }),
    }));
  });

  it('СЃС‡РёС‚Р°РµС‚ С…СЂР°РЅРµРЅРёРµ СЃ РґРЅСЏ РїРѕСЃР»Рµ РїСЂРёРµРјРєРё Рё РґРѕ РґРЅСЏ РѕС‚РіСЂСѓР·РєРё РІРєР»СЋС‡РёС‚РµР»СЊРЅРѕ', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ storageAccountingEnabled: true, storagePriceRubPerLiterDay: '0.15' }),
      },
      billingService: {
        upsert: vi.fn().mockResolvedValue({
          id: 'service-storage',
          code: 'STORAGE_LITER_DAY',
          defaultPriceRub: null,
        }),
      },
      billingCharge: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'charge-storage' }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          {
            skuId: 'sku-1',
            type: MovementType.RECEIPT,
            status: 'AVAILABLE',
            quantity: 100,
            createdAt: new Date('2026-07-01T09:00:00.000Z'),
            sku: { id: 'sku-1', internalSku: 'SKU-1', name: 'РўРѕРІР°СЂ', volumeLiters: '1' },
          },
          {
            skuId: 'sku-1',
            type: MovementType.SHIP,
            status: 'AVAILABLE',
            quantity: -20,
            createdAt: new Date('2026-07-11T18:00:00.000Z'),
            sku: { id: 'sku-1', internalSku: 'SKU-1', name: 'РўРѕРІР°СЂ', volumeLiters: '1' },
          },
        ]),
      },
      stockBalance: {
        findMany: vi.fn(),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.generateStorageCharge(
      {
        clientId: 'client-1',
        periodFrom: '2026-07-01',
        periodTo: '2026-07-30',
        unitPriceRub: 0.15,
        approve: true,
      },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    const createCall = vi.mocked(prisma.billingCharge.create).mock.calls[0]?.[0] as {
      data: { quantity: number; totalRub: number; metadata: { daily: Array<{ date: string; totalLiters: number }> } };
    };
    expect(createCall.data.quantity).toBe(2520);
    expect(createCall.data.totalRub).toBe(378);
    expect(createCall.data.metadata.daily).toHaveLength(30);
    expect(createCall.data.metadata.daily[0]).toMatchObject({ date: '2026-07-01', totalLiters: 0 });
    expect(createCall.data.metadata.daily[1]).toMatchObject({ date: '2026-07-02', totalLiters: 100 });
    expect(createCall.data.metadata.daily[10]).toMatchObject({ date: '2026-07-11', totalLiters: 100 });
    expect(createCall.data.metadata.daily[11]).toMatchObject({ date: '2026-07-12', totalLiters: 80 });
    expect(createCall.data.metadata.daily[29]).toMatchObject({ date: '2026-07-30', totalLiters: 80 });
  });

  it('does not create storage charge when storage accounting is disabled', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ storageAccountingEnabled: false, storagePriceRubPerLiterDay: '0.5' }),
      },
      billingService: {
        upsert: vi.fn().mockResolvedValue({
          id: 'service-storage',
          code: 'STORAGE_LITER_DAY',
          defaultPriceRub: null,
        }),
      },
      billingCharge: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      stockMovement: {
        findMany: vi.fn(),
      },
      stockBalance: {
        findMany: vi.fn(),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await expect(
      service.generateStorageCharge(
        {
          clientId: 'client-1',
          periodFrom: '2026-06-01',
          periodTo: '2026-06-03',
          unitPriceRub: 0.5,
        },
        user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.stockMovement.findMany).not.toHaveBeenCalled();
    expect(prisma.stockBalance.findMany).not.toHaveBeenCalled();
    expect(prisma.billingCharge.create).not.toHaveBeenCalled();
  });

  it('РёСЃРїРѕР»СЊР·СѓРµС‚ snapshot РѕСЃС‚Р°С‚РєРѕРІ, РµСЃР»Рё ledger РїРѕ РєР»РёРµРЅС‚Сѓ РµС‰Рµ РїСѓСЃС‚РѕР№', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ storageAccountingEnabled: true, storagePriceRubPerLiterDay: '0.5' }),
      },
      billingService: {
        upsert: vi.fn().mockResolvedValue({
          id: 'service-storage',
          code: 'STORAGE_LITER_DAY',
          defaultPriceRub: null,
        }),
      },
      billingCharge: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'charge-storage' }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { quantity: 2, sku: { volumeLiters: '1.500' } },
          { quantity: 3, sku: { volumeLiters: '2.000' } },
          { quantity: 1, sku: { volumeLiters: null } },
        ]),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.generateStorageCharge(
      {
        clientId: 'client-1',
        periodFrom: '2026-06-01',
        periodTo: '2026-06-03',
        unitPriceRub: 0.5,
      },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(prisma.stockBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-1',
          quantity: { gt: 0 },
        }),
      }),
    );
    expect(prisma.billingCharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 27,
          totalRub: 13.5,
          metadata: expect.objectContaining({
            calculationMode: 'SNAPSHOT',
            days: 3,
            totalLiters: 9,
            literDays: 27,
            balancesCount: 3,
            skippedWithoutVolume: 1,
          }),
        }),
      }),
    );
  });

  it('calculates storage volume from dimensions when saved liters are empty', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ storageAccountingEnabled: true, storagePriceRubPerLiterDay: '0.06' }),
      },
      billingService: {
        upsert: vi.fn().mockResolvedValue({
          id: 'service-storage',
          code: 'STORAGE_LITER_DAY',
          defaultPriceRub: null,
        }),
      },
      billingCharge: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'charge-storage' }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            quantity: 2,
            sku: {
              id: 'sku-1',
              internalSku: 'SKU-1',
              name: 'РўРѕРІР°СЂ СЃ РіР°Р±Р°СЂРёС‚Р°РјРё',
              volumeLiters: null,
              lengthCm: '43',
              widthCm: '33',
              heightCm: '6',
            },
          },
        ]),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.generateStorageCharge(
      {
        clientId: 'client-1',
        periodFrom: '2026-06-01',
        periodTo: '2026-06-03',
        unitPriceRub: 0.06,
      },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(prisma.billingCharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 51.084,
          totalRub: 3.07,
          metadata: expect.objectContaining({
            totalLiters: 17.028,
            literDays: 51.084,
            skippedWithoutVolume: 0,
          }),
        }),
      }),
    );
  });

  it('updates repeated automatic storage charge before invoice creation', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ storageAccountingEnabled: true, storagePriceRubPerLiterDay: '0.5' }),
      },
      billingService: {
        upsert: vi.fn().mockResolvedValue({
          id: 'service-storage',
          code: 'STORAGE_LITER_DAY',
          defaultPriceRub: null,
        }),
      },
      billingCharge: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'existing-storage',
          invoiceItems: [],
        }),
        update: vi.fn().mockResolvedValue({ id: 'existing-storage' }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { quantity: 2, sku: { volumeLiters: '1.500' } },
          { quantity: 3, sku: { volumeLiters: '2.000' } },
        ]),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.generateStorageCharge(
      {
        clientId: 'client-1',
        periodFrom: '2026-06-01',
        periodTo: '2026-06-03',
        unitPriceRub: 0.5,
        approve: true,
      },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(prisma.billingCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-storage' },
        data: expect.objectContaining({
          clientId: 'client-1',
          serviceId: 'service-storage',
          quantity: 27,
          totalRub: 13.5,
          status: BillingChargeStatus.APPROVED,
          source: BillingChargeSource.STORAGE,
          sourceKey: 'storage:client-1:2026-06-01:2026-06-03',
          approvedByUserId: 'user-1',
        }),
      }),
    );
  });

  it('СѓС‚РІРµСЂР¶РґР°РµС‚ РЅР°С‡РёСЃР»РµРЅРёРµ Рё С„РёРєСЃРёСЂСѓРµС‚ РѕС‚РІРµС‚СЃС‚РІРµРЅРЅРѕРіРѕ', async () => {
    const prisma = {
      billingCharge: {
        findUnique: vi.fn().mockResolvedValue({ id: 'charge-1', clientId: 'client-1' }),
        update: vi.fn().mockResolvedValue({ id: 'charge-1', status: BillingChargeStatus.APPROVED }),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.updateChargeStatus(
      'charge-1',
      { status: BillingChargeStatus.APPROVED },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(prisma.billingCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BillingChargeStatus.APPROVED,
          approvedByUserId: 'user-1',
          approvedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('СЃРѕР·РґР°РµС‚ СЃС‡РµС‚ РёР· СѓС‚РІРµСЂР¶РґРµРЅРЅС‹С… РЅР°С‡РёСЃР»РµРЅРёР№ РїРµСЂРёРѕРґР°', async () => {
    const prisma = {
      billingCharge: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'charge-1',
            description: 'РҐСЂР°РЅРµРЅРёРµ',
            unit: BillingUnit.LITER,
            quantity: '10',
            unitPriceRub: '2.00',
            totalRub: '20.00',
            serviceDate: new Date('2026-06-10T00:00:00.000Z'),
          },
          {
            id: 'charge-2',
            description: 'РџСЂРёРµРјРєР°',
            unit: BillingUnit.BOX,
            quantity: '3',
            unitPriceRub: '15.00',
            totalRub: '45.00',
            serviceDate: new Date('2026-06-12T00:00:00.000Z'),
          },
        ]),
      },
      billingInvoice: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: 'invoice-1', number: 'INV-202606-0001' }),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.createInvoice(
      {
        clientId: 'client-1',
        periodFrom: '2026-06-01',
        periodTo: '2026-06-30',
      },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(prisma.billingCharge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-1',
          status: BillingChargeStatus.APPROVED,
          invoiceItems: expect.objectContaining({
            none: expect.any(Object),
          }),
        }),
      }),
    );
    expect(prisma.billingInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number: 'INV-202606-0001',
          totalRub: 65,
          createdByUserId: 'user-1',
          items: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ chargeId: 'charge-1', totalRub: '20.00' }),
              expect.objectContaining({ chargeId: 'charge-2', totalRub: '45.00' }),
            ]),
          }),
        }),
      }),
    );
  });

  it('РЅРµ СЃРѕР·РґР°РµС‚ СЃС‡РµС‚ Р±РµР· РґРѕСЃС‚СѓРїРЅС‹С… СѓС‚РІРµСЂР¶РґРµРЅРЅС‹С… РЅР°С‡РёСЃР»РµРЅРёР№', async () => {
    const prisma = {
      billingCharge: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    await expect(
      service.createInvoice(
        {
          clientId: 'client-1',
          periodFrom: '2026-06-01',
          periodTo: '2026-06-30',
        },
        user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('sets invoice paid amount when the invoice is marked as paid', async () => {
    const tx = {
      billingInvoice: {
        update: vi.fn().mockResolvedValue({ id: 'invoice-1', status: BillingInvoiceStatus.PAID }),
      },
      clientNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      clientNotification: {
        create: vi.fn().mockResolvedValue({ id: 'notification-1' }),
      },
    };
    const prisma = {
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'invoice-1',
          number: 'INV-202606-0001',
          clientId: 'client-1',
          totalRub: '100.00',
          paidRub: '40.00',
          status: BillingInvoiceStatus.ISSUED,
          issuedAt: new Date('2026-06-15T00:00:00.000Z'),
          paidAt: null,
        }),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.updateInvoiceStatus(
      'invoice-1',
      { status: BillingInvoiceStatus.PAID },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(tx.billingInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BillingInvoiceStatus.PAID,
          paidRub: 100,
          paidAt: expect.any(Date),
        }),
      }),
    );
  });

  it('СЃРѕР·РґР°РµС‚ РєР»РёРµРЅС‚СЃРєРѕРµ СѓРІРµРґРѕРјР»РµРЅРёРµ РїСЂРё СЃРјРµРЅРµ СЃС‚Р°С‚СѓСЃР° СЃС‡РµС‚Р°', async () => {
    const tx = {
      billingInvoice: {
        update: vi.fn().mockResolvedValue({ id: 'invoice-1', status: BillingInvoiceStatus.ISSUED }),
      },
      clientNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      clientNotification: {
        create: vi.fn().mockResolvedValue({ id: 'notification-1' }),
      },
    };
    const prisma = {
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'invoice-1',
          number: 'INV-202606-0001',
          clientId: 'client-1',
          totalRub: '100.00',
          paidRub: '0.00',
          status: BillingInvoiceStatus.DRAFT,
          issuedAt: null,
          paidAt: null,
        }),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.updateInvoiceStatus(
      'invoice-1',
      { status: BillingInvoiceStatus.ISSUED },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(tx.clientNotificationPreference.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId_eventType: {
            clientId: 'client-1',
            eventType: ClientNotificationEvent.BILLING_INVOICE_STATUS_CHANGED,
          },
        },
      }),
    );
    expect(tx.clientNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          title: 'Статус счета изменен',
          body: 'Счет № INV-202606-0001: черновик -> выставлен',
          severity: 'INFO',
        }),
      }),
    );
  });

  it('РїСЂРёРЅРёРјР°РµС‚ РѕРїР»Р°С‚Сѓ Рё Р·Р°РєСЂС‹РІР°РµС‚ СЃС‡РµС‚ РїСЂРё РїРѕР»РЅРѕР№ СЃСѓРјРјРµ', async () => {
    const prisma = {
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'invoice-1',
          number: 'INV-1',
          clientId: 'client-1',
          status: BillingInvoiceStatus.ISSUED,
          totalRub: '100.00',
          paidRub: '40.00',
          issuedAt: new Date('2026-06-15T00:00:00.000Z'),
        }),
        update: vi.fn().mockResolvedValue({ id: 'invoice-1', status: BillingInvoiceStatus.PAID }),
      },
      billingPayment: {
        create: vi.fn().mockResolvedValue({ id: 'payment-1' }),
      },
      clientNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      clientNotification: {
        create: vi.fn().mockResolvedValue({ id: 'notification-1' }),
      },
      $transaction: vi.fn((callback) => callback(prisma)),
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.createPayment(
      {
        invoiceId: 'invoice-1',
        amountRub: 60,
        paidAt: '2026-06-20',
        method: 'bank',
      },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(prisma.billingPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceId: 'invoice-1',
          clientId: 'client-1',
          amountRub: 60,
          method: 'bank',
          createdByUserId: 'user-1',
        }),
      }),
    );
    expect(prisma.billingInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paidRub: 100,
          status: BillingInvoiceStatus.PAID,
          paidAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.clientNotificationPreference.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId_eventType: {
            clientId: 'client-1',
            eventType: ClientNotificationEvent.BILLING_PAYMENT_RECORDED,
          },
        },
      }),
    );
    expect(prisma.clientNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          title: 'Оплата по счету принята',
          severity: 'SUCCESS',
        }),
      }),
    );
  });

  it('СЃРѕР±РёСЂР°РµС‚ СЃРІРµСЂРєСѓ Р·Р°РґРѕР»Р¶РµРЅРЅРѕСЃС‚Рё РїРѕ РґРѕСЃС‚СѓРїРЅС‹Рј СЃС‡РµС‚Р°Рј РєР»РёРµРЅС‚Р°', async () => {
    const prisma = {
      billingInvoice: {
        findMany: vi.fn().mockResolvedValue([
          billingInvoice({
            id: 'invoice-overdue',
            number: 'INV-202606-0001',
            totalRub: '1000.00',
            paidRub: '250.00',
            dueDate: new Date('2020-06-01T23:59:59.999Z'),
            status: BillingInvoiceStatus.ISSUED,
          }),
          billingInvoice({
            id: 'invoice-paid',
            number: 'INV-202606-0002',
            totalRub: '300.00',
            paidRub: '300.00',
            dueDate: new Date('2026-06-20T23:59:59.999Z'),
            status: BillingInvoiceStatus.PAID,
            paidAt: new Date('2026-06-18T00:00:00.000Z'),
          }),
        ]),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    const report = await service.listReconciliation(
      { periodFrom: '2026-06-01', periodTo: '2026-06-30' },
      user({ clientIds: ['client-1'] }),
    );

    expect(prisma.billingInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: { in: ['client-1'] },
          status: { not: BillingInvoiceStatus.CANCELLED },
          periodFrom: expect.objectContaining({ gte: expect.any(Date) }),
          periodTo: expect.objectContaining({ lte: expect.any(Date) }),
        }),
      }),
    );
    expect(report.totals).toMatchObject({
      invoicesCount: 2,
      paidInvoicesCount: 1,
      openInvoicesCount: 1,
      overdueInvoicesCount: 1,
      totalRub: 1300,
      paidRub: 550,
      debtRub: 750,
      overdueRub: 750,
    });
    expect(report.clients[0]).toMatchObject({
      client: { id: 'client-1', code: 'CLIENT', name: 'Client' },
      debtRub: 750,
      overdueRub: 750,
      nearestDueDate: '2020-06-01T23:59:59.999Z',
    });
    expect(report.clients[0].invoices[0]).toMatchObject({
      number: 'INV-202606-0001',
      remainingRub: 750,
      overdueDays: expect.any(Number),
    });
  });

  it('groups client service history by service and source', async () => {
    const prisma = {
      billingCharge: {
        findMany: vi.fn().mockResolvedValue([
          billingCharge({
            id: 'charge-1',
            serviceId: 'service-1',
            description: 'РџСЂРёРµРјРєР° РєРѕСЂРѕР±РѕРІ',
            quantity: '2',
            totalRub: '200',
            status: BillingChargeStatus.APPROVED,
            serviceDate: new Date('2026-06-20T00:00:00.000Z'),
            service: {
              id: 'service-1',
              code: 'RECEIVING',
              name: 'РџСЂРёРµРјРєР° РєРѕСЂРѕР±РѕРІ',
              unit: BillingUnit.BOX,
            },
          }),
          billingCharge({
            id: 'charge-2',
            serviceId: 'service-1',
            description: 'РџСЂРёРµРјРєР° РєРѕСЂРѕР±РѕРІ',
            quantity: '3',
            totalRub: '300',
            status: BillingChargeStatus.DRAFT,
            serviceDate: new Date('2026-06-21T00:00:00.000Z'),
            service: {
              id: 'service-1',
              code: 'RECEIVING',
              name: 'РџСЂРёРµРјРєР° РєРѕСЂРѕР±РѕРІ',
              unit: BillingUnit.BOX,
            },
          }),
        ]),
      },
    };
    const service = new BillingService(prisma as never, clientScopes());

    const history = await service.listServiceHistory(
      { clientId: 'client-1', periodFrom: '2026-06-01', periodTo: '2026-06-30' },
      user({ clientIds: ['client-1'] }),
    );

    expect(prisma.billingCharge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-1',
          serviceDate: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      }),
    );
    expect(history.totals).toMatchObject({
      chargesCount: 2,
      totalRub: 500,
      approvedRub: 200,
      draftRub: 300,
    });
    expect(history.groups).toHaveLength(1);
    expect(history.groups[0]).toMatchObject({
      serviceCode: 'RECEIVING',
      serviceName: 'РџСЂРёРµРјРєР° РєРѕСЂРѕР±РѕРІ',
      chargesCount: 2,
      quantity: 5,
      totalRub: 500,
      latestStatus: BillingChargeStatus.DRAFT,
    });
  });

  it.each([BillingInvoiceStatus.DRAFT, BillingInvoiceStatus.ISSUED])(
    'updates, adds, and removes rows in a %s invoice without payments',
    async (invoiceStatus) => {
    const invoice = billingInvoice({
      status: invoiceStatus,
      paidRub: '0',
      payments: [],
      requestId: 'request-1',
      items: [
        { id: 'item-keep', chargeId: 'charge-keep' },
        { id: 'item-remove', chargeId: 'charge-remove' },
      ],
    });
    const tx = {
      billingCharge: {
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({ id: 'charge-new' }),
      },
      billingInvoiceItem: {
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      billingInvoice: {
        update: vi.fn().mockResolvedValue({ id: 'invoice-1', totalRub: '60' }),
      },
    };
    const prisma = {
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue(invoice),
      },
      billingService: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
      },
      clientBillingService: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new BillingService(prisma as never, clientScopes());

    await service.updateManualInvoice(
      'invoice-1',
      {
        clientId: 'client-1',
        periodFrom: '2026-06-01',
        periodTo: '2026-06-30',
        rows: [
          {
            invoiceItemId: 'item-keep',
            description: 'Updated service',
            unit: BillingUnit.SERVICE,
            quantity: 2,
            unitPriceRub: 25,
          },
          {
            description: 'New service',
            unit: BillingUnit.SERVICE,
            quantity: 1,
            unitPriceRub: 10,
          },
        ],
      },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(tx.billingInvoiceItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-keep' },
        data: expect.objectContaining({ totalRub: 50 }),
      }),
    );
    expect(tx.billingInvoiceItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invoiceId: 'invoice-1', chargeId: 'charge-new', totalRub: 10 }),
      }),
    );
    expect(tx.billingInvoiceItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['item-remove'] } } });
    expect(tx.billingCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'charge-remove' },
        data: expect.objectContaining({ status: BillingChargeStatus.CANCELLED }),
      }),
    );
    expect(tx.billingInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalRub: 60 }) }),
    );
    },
  );
});

function clientScopes() {
  return {
    resolveClientFilter: (user: AuthUser, requestedClientId?: string) =>
      requestedClientId ?? (user.clientScopeMode === 'ALL' ? undefined : { in: user.clientIds }),
    requireClientAccess: vi.fn(),
    requireGlobalClientAccess: vi.fn(),
  } as never;
}

function user(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: 'user-1',
    email: 'manager@example.com',
    name: 'Manager',
    roleCodes: ['MANAGER'],
    permissionCodes: ['billing:read', 'billing:write'],
    clientScopeMode: 'LIMITED',
    clientIds: [],
    writableClientIds: [],
    ...overrides,
  };
}

function billingCharge(overrides: Record<string, unknown>) {
  return {
    id: 'charge',
    clientId: 'client-1',
    serviceId: null,
    requestId: null,
    description: 'РЈСЃР»СѓРіР°',
    unit: BillingUnit.SERVICE,
    quantity: '1',
    unitPriceRub: '100',
    totalRub: '100',
    status: BillingChargeStatus.DRAFT,
    serviceDate: new Date('2026-06-20T00:00:00.000Z'),
    source: BillingChargeSource.MANUAL,
    sourceKey: null,
    metadata: null,
    comment: null,
    approvedAt: null,
    createdAt: new Date('2026-06-20T00:00:00.000Z'),
    updatedAt: new Date('2026-06-20T00:00:00.000Z'),
    client: { id: 'client-1', code: 'CLIENT', name: 'Client' },
    service: null,
    request: null,
    createdBy: null,
    approvedBy: null,
    ...overrides,
  };
}

function billingInvoice(overrides: Record<string, unknown>) {
  return {
    id: 'invoice-1',
    number: 'INV-202606-0001',
    clientId: 'client-1',
    periodFrom: new Date('2026-06-01T00:00:00.000Z'),
    periodTo: new Date('2026-06-30T23:59:59.999Z'),
    dueDate: new Date('2026-06-15T23:59:59.999Z'),
    status: BillingInvoiceStatus.ISSUED,
    totalRub: '100.00',
    paidRub: '0.00',
    issuedAt: new Date('2026-06-10T00:00:00.000Z'),
    paidAt: null,
    comment: null,
    createdByUserId: 'user-1',
    createdAt: new Date('2026-06-10T00:00:00.000Z'),
    updatedAt: new Date('2026-06-10T00:00:00.000Z'),
    client: { id: 'client-1', code: 'CLIENT', name: 'Client' },
    ...overrides,
  };
}
