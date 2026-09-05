import { ForbiddenException } from '@nestjs/common';
import { ClientRequestEventType, ClientRequestStatus, ClientRequestType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { ClientRequestHistoryService } from '../src/modules/client-requests/client-request-history.service';

describe('ClientRequestHistoryService', () => {
  it('скрывает внутренние комментарии от клиентской роли', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(request()),
      },
      clientRequestComment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      clientRequestEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new ClientRequestHistoryService(prisma as never, new ClientScopeService());

    await service.getTimeline('request-1', user({ clientIds: ['client-1'] }));

    expect(prisma.clientRequestComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requestId: 'request-1',
          isInternal: false,
        }),
      }),
    );
  });

  it('записывает внешний комментарий, событие и уведомление для клиента', async () => {
    const tx = {
      clientRequestComment: {
        create: vi.fn().mockResolvedValue({ id: 'comment-1', body: 'Готово' }),
      },
      clientRequestEvent: {
        create: vi.fn().mockResolvedValue({ id: 'event-1' }),
      },
      clientNotification: {
        create: vi.fn().mockResolvedValue({ id: 'notification-1' }),
      },
    };
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(request()),
      },
      // TEST: notification preference is read before entering the write transaction.
      clientNotificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new ClientRequestHistoryService(prisma as never, new ClientScopeService());

    await service.addComment(
      'request-1',
      { body: 'Готово' },
      user({
        roleCodes: ['MANAGER'],
        permissionCodes: ['client-requests:read', 'client-requests:write', 'client-requests:status'],
        clientScopeMode: 'ALL',
      }),
    );

    expect(tx.clientRequestComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: 'request-1',
          clientId: 'client-1',
          body: 'Готово',
          isInternal: false,
        }),
      }),
    );
    expect(tx.clientRequestEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: ClientRequestEventType.COMMENT,
          title: 'Добавлен комментарий',
        }),
      }),
    );
    expect(tx.clientNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          requestId: 'request-1',
          title: 'Новый комментарий по заявке',
        }),
      }),
    );
  });

  it('не дает клиенту создать внутренний комментарий', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(request()),
      },
    };
    const service = new ClientRequestHistoryService(prisma as never, new ClientScopeService());

    await expect(
      service.addComment(
        'request-1',
        { body: 'Скрыто', isInternal: true },
        user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

function request() {
  return {
    id: 'request-1',
    clientId: 'client-1',
    title: 'Заявка',
    type: ClientRequestType.SERVICE,
    status: ClientRequestStatus.SUBMITTED,
    createdAt: new Date('2026-06-26T10:00:00.000Z'),
    client: {
      id: 'client-1',
      code: 'CLIENT',
      name: 'Client',
    },
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
