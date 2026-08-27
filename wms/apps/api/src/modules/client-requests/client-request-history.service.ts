import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientNotificationEvent, ClientRequestEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { isClientNotificationEnabled } from '../client-notifications/client-notification-preferences';
import { TelegramNotificationService } from '../client-notifications/telegram-notification.service';
import { CreateClientRequestCommentDto } from './dto/create-client-request-comment.dto';
import { assertWarehouseAccess } from './client-request-warehouse-scope';

@Injectable()
export class ClientRequestHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly telegram?: TelegramNotificationService,
  ) {}

  async getTimeline(requestId: string, user: AuthUser) {
    const request = await this.getRequestForAccess(requestId);
    this.clientScopes.requireClientAccess(user, request.clientId, 'read');
    assertWarehouseAccess(user, request, 'read', 'Заявка не найдена в выбранном филиале.');
    const includeInternal = canSeeInternalComments(user);

    const [comments, events] = await Promise.all([
      this.prisma.clientRequestComment.findMany({
        where: {
          requestId,
          isInternal: includeInternal ? undefined : false,
        },
        include: clientRequestCommentInclude,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.clientRequestEvent.findMany({
        where: { requestId },
        include: clientRequestEventInclude,
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      request,
      comments,
      events,
    };
  }

  async addComment(requestId: string, dto: CreateClientRequestCommentDto, user: AuthUser) {
    const request = await this.getRequestForAccess(requestId);
    this.clientScopes.requireClientAccess(user, request.clientId, 'write');
    assertWarehouseAccess(user, request, 'write', 'Заявка не найдена в выбранном филиале.');

    const isInternal = dto.isInternal === true;
    if (isInternal && !canSeeInternalComments(user)) {
      throw new ForbiddenException('Внутренний комментарий доступен только сотрудникам.');
    }

    const body = dto.body.trim();
    if (!body) {
      throw new BadRequestException('Комментарий не должен быть пустым.');
    }

    const notifyClient =
      !isInternal &&
      shouldNotifyClient(user) &&
      (await isClientNotificationEnabled(this.prisma, request.clientId, ClientNotificationEvent.REQUEST_COMMENT));

    // Русский комментарий: комментарий, событие и уведомление пишем одной транзакцией, чтобы история заявки не расходилась с кабинетом клиента.
    const comment = await this.prisma.$transaction(async (tx) => {
      const comment = await tx.clientRequestComment.create({
        data: {
          requestId,
          clientId: request.clientId,
          authorUserId: user.id,
          body,
          isInternal,
        },
        include: clientRequestCommentInclude,
      });

      await tx.clientRequestEvent.create({
        data: {
          requestId,
          clientId: request.clientId,
          eventType: ClientRequestEventType.COMMENT,
          title: isInternal ? 'Внутренний комментарий' : 'Добавлен комментарий',
          body: isInternal ? undefined : body,
          createdByUserId: user.id,
        },
      });

      if (notifyClient) {
        await tx.clientNotification.create({
          data: {
            clientId: request.clientId,
            requestId,
            title: 'Новый комментарий по заявке',
            body: `${request.title}: ${body.slice(0, 180)}`,
            severity: 'INFO',
            createdByUserId: user.id,
          },
        });
      }

      return comment;
    });

    if (notifyClient) {
      void this.telegram?.notifyClient(
        request.clientId,
        ['LOGOFF WMS: новый комментарий по заявке.', `Заявка: ${request.title}`, body].join('\n'),
      );
    }

    return comment;
  }

  private async getRequestForAccess(requestId: string) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        number: true,
        clientId: true,
        warehouseId: true,
        title: true,
        type: true,
        status: true,
        createdAt: true,
        client: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    return request;
  }
}

export const clientRequestCommentInclude = {
  author: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} satisfies Prisma.ClientRequestCommentInclude;

export const clientRequestEventInclude = {
  createdBy: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} satisfies Prisma.ClientRequestEventInclude;

function canSeeInternalComments(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes('client-requests:status');
}

function shouldNotifyClient(user: AuthUser) {
  return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes('client-requests:status');
}
