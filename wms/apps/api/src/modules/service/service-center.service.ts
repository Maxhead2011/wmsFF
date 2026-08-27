import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientRequestStatus, Prisma } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import {
  TelegramNotificationService,
  telegramNotificationSections,
  type TelegramNotificationSection,
} from '../client-notifications/telegram-notification.service';

const CLEANUP_CONFIRMATION = 'ОЧИСТИТЬ';
const REQUEST_DELETE_CONFIRMATION = 'УДАЛИТЬ ЗАЯВКИ';

@Injectable()
export class ServiceCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly telegram: TelegramNotificationService,
  ) {}

  async getClientStockCleanupPreview(clientId: string) {
    const client = await this.findClient(clientId);
    const summary = await this.getClientStockSummary(clientId);

    return {
      client,
      summary,
      confirmationText: CLEANUP_CONFIRMATION,
      warning:
        'Будут удалены остатки, движения склада, КИЗы, короба и паллеты выбранного клиента. Клиент, пользователи, SKU, каталог и API маркетплейсов останутся.',
    };
  }

  async purgeClientStock(clientId: string, confirmation: string | undefined, user: AuthUser) {
    if (confirmation !== CLEANUP_CONFIRMATION) {
      throw new BadRequestException(`Для очистки введите подтверждение: ${CLEANUP_CONFIRMATION}.`);
    }

    const client = await this.findClient(clientId);
    const before = await this.getClientStockSummary(clientId);

    const deleted = await this.prisma.$transaction(async (tx) => {
      const productMarks = await tx.productMark.deleteMany({ where: { clientId } });
      const balances = await tx.stockBalance.deleteMany({ where: { clientId } });
      const movements = await tx.stockMovement.deleteMany({ where: { clientId } });
      const boxes = await tx.box.deleteMany({ where: { clientId } });
      const pallets = await tx.pallet.deleteMany({ where: { clientId } });

      return {
        productMarks: productMarks.count,
        balances: balances.count,
        movements: movements.count,
        boxes: boxes.count,
        pallets: pallets.count,
      };
    });

    await this.auditLog.write({
      userId: user.id,
      action: 'service.client-stock.purge',
      entity: 'client',
      entityId: clientId,
      payload: {
        clientCode: client.code,
        clientName: client.name,
        before,
        deleted,
      },
    });

    return {
      client,
      before,
      deleted,
      after: await this.getClientStockSummary(clientId),
    };
  }

  async getClientRequestsCleanupPreview(clientId: string) {
    const client = await this.findClient(clientId);
    const statuses = await this.prisma.clientRequest.groupBy({
      by: ['status'],
      where: { clientId },
      _count: { _all: true },
    });
    const requests = await this.prisma.clientRequest.findMany({
      where: { clientId },
      select: {
        id: true,
        title: true,
        status: true,
        destinationCity: true,
        createdAt: true,
        _count: {
          select: {
            items: true,
            files: true,
            comments: true,
            events: true,
            packages: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      client,
      confirmationText: REQUEST_DELETE_CONFIRMATION,
      total: statuses.reduce((sum, row) => sum + row._count._all, 0),
      statuses: statuses.map((row) => ({ status: row.status, count: row._count._all })),
      requests,
      warning:
        'Будут удалены заявки выбранного клиента. Финансовые начисления и логистические заявки не удаляются, а отвязываются от удаляемых заявок.',
    };
  }

  async purgeClientRequests(clientId: string, confirmation: string | undefined, user: AuthUser) {
    if (confirmation !== REQUEST_DELETE_CONFIRMATION) {
      throw new BadRequestException(`Для удаления заявок введите подтверждение: ${REQUEST_DELETE_CONFIRMATION}.`);
    }

    const client = await this.findClient(clientId);
    const requestIds = (
      await this.prisma.clientRequest.findMany({
        where: { clientId },
        select: { id: true },
      })
    ).map((request) => request.id);

    if (requestIds.length === 0) {
      return {
        client,
        deleted: { requests: 0, pickWaveRequests: 0, detachedBillingCharges: 0, detachedLogistics: 0 },
      };
    }

    const deleted = await this.prisma.$transaction(async (tx) => {
      const pickWaveRequests = await tx.pickWaveRequest.deleteMany({ where: { requestId: { in: requestIds } } });
      const detachedBillingCharges = await tx.billingCharge.updateMany({
        where: { requestId: { in: requestIds } },
        data: { requestId: null },
      });
      const detachedLogistics = await tx.logisticsDeliveryRequest.updateMany({
        where: { requestId: { in: requestIds } },
        data: { requestId: null },
      });
      const requests = await tx.clientRequest.deleteMany({ where: { id: { in: requestIds } } });

      return {
        requests: requests.count,
        pickWaveRequests: pickWaveRequests.count,
        detachedBillingCharges: detachedBillingCharges.count,
        detachedLogistics: detachedLogistics.count,
      };
    });

    await this.auditLog.write({
      userId: user.id,
      action: 'service.client-requests.purge',
      entity: 'client',
      entityId: clientId,
      payload: {
        clientCode: client.code,
        clientName: client.name,
        deleted,
      },
    });

    return { client, deleted };
  }

  async getMaintenanceMode() {
    const event = await this.prisma.auditLog.findFirst({
      where: { action: 'service.maintenance.update', entity: 'system' },
      orderBy: { createdAt: 'desc' },
    });
    const payload = asRecord(event?.payload);

    return {
      enabled: payload?.enabled === true,
      message: typeof payload?.message === 'string' ? payload.message : '',
      updatedAt: event?.createdAt ?? null,
    };
  }

  async updateMaintenanceMode(payload: { enabled?: boolean; message?: string }, user: AuthUser) {
    const settings = {
      enabled: payload.enabled === true,
      message: normalizeText(payload.message) ?? 'Вход временно закрыт: идут сервисные работы.',
    };

    await this.auditLog.write({
      userId: user.id,
      action: 'service.maintenance.update',
      entity: 'system',
      payload: settings,
    });

    return this.getMaintenanceMode();
  }

  async listRecentSessions() {
    const sessions = await this.prisma.userSession.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            clientScopes: {
              include: {
                client: { select: { id: true, code: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 80,
    });

    const now = Date.now();
    return sessions.map((session) => {
      return {
        id: session.id,
        userId: session.userId,
        name: session.user?.name ?? 'Пользователь удален',
        email: session.user?.email ?? '',
        client: session.user?.clientScopes.length
          ? session.user.clientScopes.map((scope) => `${scope.client.code} ${scope.client.name}`).join(', ')
          : 'Все клиенты или не задан',
        ip: session.ipAddress ?? '',
        userAgent: session.userAgent ?? '',
        appName: session.appName,
        browserName: session.browserName,
        openedAt: session.startedAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        isActive: !session.expiresAt || session.expiresAt.getTime() > now,
        minutesAgo: Math.max(0, Math.round((now - session.lastSeenAt.getTime()) / 60_000)),
      };
    });
  }

  async closeSession(sessionId: string, user: AuthUser) {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!session) {
      throw new NotFoundException('Сессия не найдена.');
    }

    const closedAt = new Date();
    const updated = await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { expiresAt: closedAt, lastSeenAt: closedAt },
    });
    await this.auditLog.write({
      userId: user.id,
      action: 'service.session.close',
      entity: 'user-session',
      entityId: sessionId,
      payload: {
        sessionUserId: session.userId,
        sessionUserName: session.user.name,
        sessionUserEmail: session.user.email,
        closedAt: closedAt.toISOString(),
      },
    });

    return { id: updated.id, closed: true, closedAt };
  }

  async getTelegramSettings(clientId?: string) {
    const [global, client] = await Promise.all([
      this.telegram.getGlobalSettings(),
      clientId ? this.telegram.getClientSettings(clientId) : Promise.resolve(null),
    ]);

    return { global, client };
  }

  updateTelegramGlobalSettings(
    payload: { enabled?: boolean; botToken?: string; fulfillmentChatIds?: string[]; sections?: TelegramNotificationSection[] },
    user: AuthUser,
  ) {
    return this.telegram.updateGlobalSettings(
      {
        enabled: payload.enabled === true,
        botToken: payload.botToken ?? '',
        fulfillmentChatIds: payload.fulfillmentChatIds ?? [],
        sections: payload.sections ?? [...telegramNotificationSections],
      },
      user,
    );
  }

  async updateTelegramClientSettings(
    clientId: string,
    payload: { enabled?: boolean; chatId?: string; sections?: TelegramNotificationSection[] },
    user: AuthUser,
  ) {
    await this.findClient(clientId);
    return this.telegram.updateClientSettings(
      clientId,
      {
        enabled: payload.enabled === true,
        chatId: payload.chatId ?? '',
        sections: payload.sections ?? [...telegramNotificationSections],
      },
      user,
    );
  }

  testTelegramFulfillment() {
    return this.telegram.sendTestToFulfillment();
  }

  listTelegramGroups() {
    return this.telegram.listAvailableGroups();
  }

  async testTelegramClient(clientId: string) {
    await this.findClient(clientId);
    return this.telegram.sendTestToClient(clientId);
  }

  async searchProductMarks(query: { clientId?: string; search?: string }) {
    const search = normalizeText(query.search);
    if (!search || search.length < 3) {
      return [];
    }

    return this.prisma.productMark.findMany({
      where: {
        clientId: normalizeText(query.clientId),
        value: { contains: search, mode: 'insensitive' },
      },
      include: {
        client: { select: { id: true, code: true, name: true } },
        sku: {
          select: {
            id: true,
            internalSku: true,
            clientSku: true,
            article: true,
            name: true,
            barcodes: { select: { value: true }, take: 5 },
          },
        },
        box: { select: { id: true, code: true, status: true } },
        stockMovement: {
          select: {
            id: true,
            type: true,
            status: true,
            sourceDocument: true,
            comment: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private async findClient(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
      },
    });

    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    return client;
  }

  private async getClientStockSummary(clientId: string) {
    const [balances, movements, boxes, pallets, productMarks, skuRows] = await Promise.all([
      this.prisma.stockBalance.aggregate({
        where: { clientId },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      this.prisma.stockMovement.count({ where: { clientId } }),
      this.prisma.box.count({ where: { clientId } }),
      this.prisma.pallet.count({ where: { clientId } }),
      this.prisma.productMark.count({ where: { clientId } }),
      this.prisma.stockBalance.groupBy({
        by: ['skuId'],
        where: { clientId },
      }),
    ]);

    return {
      balanceRows: balances._count._all,
      quantity: balances._sum.quantity ?? 0,
      uniqueSkusInStock: skuRows.length,
      movements,
      boxes,
      pallets,
      productMarks,
    };
  }
}

function normalizeText(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
