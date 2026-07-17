import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientNotificationEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import {
  clientNotificationEvents,
  isClientNotificationEnabled,
} from './client-notification-preferences';
import { CreateClientNotificationDto } from './dto/create-client-notification.dto';
import { ListClientNotificationPreferencesDto } from './dto/list-client-notification-preferences.dto';
import { ListClientNotificationsDto } from './dto/list-client-notifications.dto';
import { UpdateClientNotificationPreferenceDto } from './dto/update-client-notification-preference.dto';
import { TelegramNotificationService } from './telegram-notification.service';

@Injectable()
export class ClientNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly telegram: TelegramNotificationService,
  ) {}

  list(query: ListClientNotificationsDto, user: AuthUser) {
    const clientId = this.clientScopes.resolveClientFilter(user, query.clientId);

    return this.prisma.clientNotification.findMany({
      where: {
        clientId,
        isRead: query.unreadOnly ? false : undefined,
      },
      include: clientNotificationInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async create(dto: CreateClientNotificationDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    await this.ensureRequestBelongsToClient(dto.clientId, dto.requestId);
    await this.ensureNotificationEventEnabled(dto.clientId, ClientNotificationEvent.MANUAL);

    // Русский комментарий: уведомление видно клиенту сразу в кабинете, а статус read хранится отдельно от заявки.
    const notification = await this.prisma.clientNotification.create({
      data: {
        clientId: dto.clientId,
        requestId: normalizeText(dto.requestId),
        title: dto.title.trim(),
        body: normalizeText(dto.body),
        severity: dto.severity ?? 'INFO',
        createdByUserId: user.id,
      },
      include: clientNotificationInclude,
    });

    void this.telegram.notifyClient(dto.clientId, telegramNotificationText(notification.title, notification.body));

    return notification;
  }

  async markRead(id: string, user: AuthUser) {
    const notification = await this.prisma.clientNotification.findUnique({
      where: { id },
      select: { id: true, clientId: true, isRead: true },
    });

    if (!notification) {
      throw new NotFoundException('Уведомление не найдено.');
    }

    this.clientScopes.requireClientAccess(user, notification.clientId, 'read');

    if (notification.isRead) {
      return this.prisma.clientNotification.findUniqueOrThrow({
        where: { id },
        include: clientNotificationInclude,
      });
    }

    return this.prisma.clientNotification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
      include: clientNotificationInclude,
    });
  }

  async listPreferences(query: ListClientNotificationPreferencesDto, user: AuthUser) {
    const clientId = this.clientScopes.resolveClientFilter(user, query.clientId);

    const [clients, preferences] = await Promise.all([
      this.prisma.client.findMany({
        where: { id: clientId },
        select: {
          id: true,
          code: true,
          name: true,
        },
        orderBy: { code: 'asc' },
      }),
      this.prisma.clientNotificationPreference.findMany({
        where: { clientId },
        include: clientNotificationPreferenceInclude,
      }),
    ]);

    const preferenceByClientAndEvent = new Map(
      preferences.map((preference) => [`${preference.clientId}:${preference.eventType}`, preference]),
    );

    return clients.flatMap((client) =>
      clientNotificationEvents.map((eventType) => {
        const preference = preferenceByClientAndEvent.get(`${client.id}:${eventType}`);

        return {
          id: preference?.id ?? null,
          clientId: client.id,
          eventType,
          isEnabled: preference?.isEnabled ?? true,
          createdAt: preference?.createdAt ?? null,
          updatedAt: preference?.updatedAt ?? null,
          updatedBy: preference?.updatedBy ?? null,
          client,
        };
      }),
    );
  }

  async updatePreference(dto: UpdateClientNotificationPreferenceDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'read');
    await this.ensureClientExists(dto.clientId);

    return this.prisma.clientNotificationPreference.upsert({
      where: {
        clientId_eventType: {
          clientId: dto.clientId,
          eventType: dto.eventType,
        },
      },
      create: {
        clientId: dto.clientId,
        eventType: dto.eventType,
        isEnabled: dto.isEnabled,
        updatedByUserId: user.id,
      },
      update: {
        isEnabled: dto.isEnabled,
        updatedByUserId: user.id,
      },
      include: clientNotificationPreferenceInclude,
    });
  }

  async getTelegramSettings(clientId: string | undefined, user: AuthUser) {
    const resolvedClientId = this.resolveWritableClientId(clientId, user, 'read');
    return this.telegram.getClientSettings(resolvedClientId);
  }

  async updateTelegramSettings(
    dto: { clientId?: string; enabled?: boolean; chatId?: string },
    user: AuthUser,
  ) {
    const clientId = this.resolveWritableClientId(dto.clientId, user, 'write');
    await this.ensureClientExists(clientId);
    return this.telegram.updateClientSettings(
      clientId,
      {
        enabled: dto.enabled === true,
        chatId: dto.chatId ?? '',
      },
      user,
    );
  }

  private async ensureRequestBelongsToClient(clientId: string, requestId?: string) {
    if (!requestId) {
      return;
    }

    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: { id: true, clientId: true },
    });

    if (!request || request.clientId !== clientId) {
      throw new BadRequestException('Заявка не принадлежит выбранному клиенту.');
    }
  }

  private async ensureClientExists(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found.');
    }
  }

  private resolveWritableClientId(clientId: string | undefined, user: AuthUser, mode: 'read' | 'write') {
    if (clientId) {
      this.clientScopes.requireClientAccess(user, clientId, mode);
      return clientId;
    }

    const candidates = mode === 'write' ? user.writableClientIds : user.clientIds;
    if (candidates.length === 1) {
      return candidates[0];
    }

    throw new BadRequestException('Выберите клиента для настроек Telegram.');
  }

  private async ensureNotificationEventEnabled(clientId: string, eventType: ClientNotificationEvent) {
    if (await isClientNotificationEnabled(this.prisma, clientId, eventType)) {
      return;
    }

    throw new BadRequestException('Notification event disabled by client.');
  }
}

export const clientNotificationInclude = {
  client: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  request: {
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} satisfies Prisma.ClientNotificationInclude;

export const clientNotificationPreferenceInclude = {
  client: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  updatedBy: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} satisfies Prisma.ClientNotificationPreferenceInclude;

function normalizeText(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function telegramNotificationText(title: string, body?: string | null) {
  return ['LOGOFF WMS: уведомление для клиента.', title, body ?? ''].filter(Boolean).join('\n');
}
