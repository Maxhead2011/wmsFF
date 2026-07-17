import { BadRequestException } from '@nestjs/common';
import { ClientRequestEventType, ClientRequestPriority, ClientRequestStatus, ClientRequestType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { ClientRequestsService } from '../src/modules/client-requests/client-requests.service';

describe('ClientRequestsService', () => {
  it('фильтрует список заявок по доступным клиентам пользователя', async () => {
    const prisma = {
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new ClientRequestsService(prisma as never, new ClientScopeService(), stockOperations() as never);

    await service.list({}, user({ clientIds: ['client-1', 'client-2'] }));

    expect(prisma.clientRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: { in: ['client-1', 'client-2'] },
        }),
      }),
    );
  });

  it('создает заявку в статусе SUBMITTED и привязывает автора', async () => {
    const tx = {
      clientRequest: {
        create: vi.fn().mockResolvedValue({ id: 'request-1', clientId: 'client-1', comment: null }),
      },
      clientRequestEvent: {
        create: vi.fn().mockResolvedValue({ id: 'event-1' }),
      },
    };
    const prisma = {
      sku: {
        findMany: vi.fn().mockResolvedValue([{ id: 'sku-1' }]),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new ClientRequestsService(prisma as never, new ClientScopeService(), stockOperations() as never);

    await service.create(
      {
        clientId: 'client-1',
        type: ClientRequestType.OUTBOUND,
        priority: ClientRequestPriority.HIGH,
        title: 'Отгрузка на маркетплейс',
        destinationCity: 'Казань',
        items: [{ skuId: 'sku-1', quantity: 3 }],
      },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(tx.clientRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          destinationCity: 'Казань',
          status: ClientRequestStatus.SUBMITTED,
          createdByUserId: 'user-1',
        }),
      }),
    );
    expect(tx.clientRequestEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: 'request-1',
          eventType: ClientRequestEventType.CREATED,
          statusTo: ClientRequestStatus.SUBMITTED,
        }),
      }),
    );
  });

  it('запрещает добавить в заявку SKU другого клиента', async () => {
    const prisma = {
      sku: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new ClientRequestsService(prisma as never, new ClientScopeService(), stockOperations() as never);

    await expect(
      service.create(
        {
          clientId: 'client-1',
          type: ClientRequestType.OUTBOUND,
          title: 'Чужая SKU',
          destinationCity: 'Казань',
          items: [{ skuId: 'sku-foreign', quantity: 1 }],
        },
        user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('требует город поставки при создании заявки', async () => {
    const prisma = {
      sku: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new ClientRequestsService(prisma as never, new ClientScopeService(), stockOperations() as never);

    await expect(
      service.create(
        {
          clientId: 'client-1',
          type: ClientRequestType.OUTBOUND,
          title: 'Без города',
          destinationCity: ' ',
        },
        user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('при ручном статусе DONE списывает outbound-заявку через складское SHIP-движение', async () => {
    const stock = {
      shipClientRequestFromCurrentStock: vi.fn().mockResolvedValue({ status: 'APPLIED', requestId: 'request-1' }),
    };
    const tx = {
      clientRequest: {
        update: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          type: ClientRequestType.OUTBOUND,
          status: ClientRequestStatus.DONE,
          title: 'Отгрузка',
          destinationCity: 'Казань',
          items: [],
          files: [],
          packages: [],
          client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
        }),
      },
      clientRequestEvent: {
        create: vi.fn().mockResolvedValue({ id: 'event-1' }),
      },
      clientNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      clientNotification: {
        create: vi.fn().mockResolvedValue({ id: 'notification-1' }),
      },
    };
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          type: ClientRequestType.OUTBOUND,
          status: ClientRequestStatus.PACKED,
          title: 'Отгрузка',
          packages: [],
        }),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new ClientRequestsService(prisma as never, new ClientScopeService(), stock as never);

    const updated = await service.updateStatus(
      'request-1',
      {
        status: ClientRequestStatus.DONE,
        managerComment: 'Сдано',
        boxes: 2,
        pallets: 1,
        packedUnits: 30,
      },
      user({
        clientIds: ['client-1'],
        writableClientIds: ['client-1'],
        permissionCodes: ['client-requests:read', 'client-requests:write', 'client-requests:status'],
      }),
    );

    expect(stock.shipClientRequestFromCurrentStock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        idempotencyKey: 'manual-status-done:request-1',
        comment: 'Сдано',
        boxes: 2,
        pallets: 1,
        packedUnits: 30,
      }),
      expect.any(Object),
    );
    expect(tx.clientRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'request-1' },
        data: expect.objectContaining({
          status: ClientRequestStatus.DONE,
          managerComment: 'Сдано',
          assignedToUserId: 'user-1',
        }),
      }),
    );
    expect(tx.clientRequestEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: ClientRequestEventType.STATUS_CHANGED,
          statusFrom: ClientRequestStatus.PACKED,
          statusTo: ClientRequestStatus.DONE,
        }),
      }),
    );
    expect(updated).toMatchObject({ id: 'request-1', status: ClientRequestStatus.DONE });
  });

  it('сдает аварийно упакованную заявку по ее фактическим коробам без повторного ручного списания', async () => {
    const stock = {
      shipClientRequest: vi.fn().mockResolvedValue({ status: 'ALREADY_APPLIED', requestId: 'request-1' }),
      shipClientRequestFromCurrentStock: vi.fn(),
    };
    const tx = {
      clientRequest: {
        update: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          type: ClientRequestType.OUTBOUND,
          status: ClientRequestStatus.DONE,
          title: 'Аварийная отгрузка',
          destinationCity: 'Казань',
          items: [],
          files: [],
          packages: [],
          client: { id: 'client-1', code: 'CL-1', name: 'Клиент' },
        }),
      },
      clientRequestEvent: { create: vi.fn().mockResolvedValue({ id: 'event-1' }) },
      clientNotificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
      clientNotification: { create: vi.fn().mockResolvedValue({ id: 'notification-1' }) },
    };
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          type: ClientRequestType.OUTBOUND,
          status: ClientRequestStatus.PACKED,
          title: 'Аварийная отгрузка',
          packages: [{ id: 'emergency-package-1' }],
        }),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new ClientRequestsService(prisma as never, new ClientScopeService(), stock as never);

    await service.updateStatus(
      'request-1',
      { status: ClientRequestStatus.DONE, managerComment: 'Сдано после аварийного закрытия' },
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(stock.shipClientRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        idempotencyKey: 'manual-status-done:request-1',
        comment: 'Сдано после аварийного закрытия',
      }),
      expect.any(Object),
    );
    expect(stock.shipClientRequestFromCurrentStock).not.toHaveBeenCalled();
  });

  it('позволяет клиенту отменить свою заявку до начала сборки', async () => {
    const tx = {
      clientRequest: {
        update: vi.fn().mockResolvedValue({ id: 'request-1', clientId: 'client-1', status: ClientRequestStatus.CANCELLED }),
      },
      clientRequestEvent: {
        create: vi.fn().mockResolvedValue({ id: 'event-1' }),
      },
      clientNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      clientNotification: {
        create: vi.fn().mockResolvedValue({ id: 'notification-1' }),
      },
    };
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          status: ClientRequestStatus.SUBMITTED,
          title: 'Сборка',
        }),
      },
      clientNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new ClientRequestsService(prisma as never, new ClientScopeService(), stockOperations() as never);

    const updated = await service.cancel('request-1', user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }));

    expect(updated).toMatchObject({ id: 'request-1', status: ClientRequestStatus.CANCELLED });
    expect(tx.clientRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'request-1' },
        data: expect.objectContaining({
          status: ClientRequestStatus.CANCELLED,
          managerComment: 'Отменено клиентом.',
          assignedToUserId: null,
        }),
      }),
    );
    expect(tx.clientRequestEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: ClientRequestEventType.STATUS_CHANGED,
          title: 'Заявка отменена клиентом',
          statusFrom: ClientRequestStatus.SUBMITTED,
          statusTo: ClientRequestStatus.CANCELLED,
        }),
      }),
    );
  });

  it('запрещает клиенту отменить заявку после старта сборки', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          status: ClientRequestStatus.IN_WORK,
          title: 'Сборка',
        }),
      },
    };
    const service = new ClientRequestsService(prisma as never, new ClientScopeService(), stockOperations() as never);

    await expect(
      service.cancel('request-1', user({ clientIds: ['client-1'], writableClientIds: ['client-1'] })),
    ).rejects.toThrow(BadRequestException);
  });
});

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

function stockOperations() {
  return {
    shipClientRequest: vi.fn(),
    shipClientRequestFromCurrentStock: vi.fn(),
  };
}
