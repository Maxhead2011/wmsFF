import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

export type AdminEventType = 'MISSING_PALLET_BOX' | 'PRODUCT_PROBLEM' | 'BOX_CHECK_STARTED' | 'BOX_CHECK_OPENED';
export type AdminEvent = {
  type: AdminEventType; dedupeKey: string; title: string; body: string;
  clientId: string; warehouseId?: string | null; actorId: string; actorName: string; isDemo?: boolean;
  sessionId?: string | null; auditBoxId?: string | null; requestId?: string | null;
};

// FIX: durable operational events, separate from client-facing notifications.
@Injectable()
export class AdminNotificationsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  get enabled() { return this.config.get<string>('ADMIN_OPERATIONAL_NOTIFICATIONS_ENABLED') === 'true'; }

  async record(tx: Prisma.TransactionClient, event: AdminEvent) {
    if (!this.enabled) return;
    await tx.adminNotification.upsert({
      where: { dedupeKey: event.dedupeKey }, update: {},
      create: { ...event, isDemo: event.isDemo ?? false },
    });
  }

  async withEvent<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, event: (value: T, tx: Prisma.TransactionClient) => AdminEvent | undefined | Promise<AdminEvent | undefined>): Promise<T> {
    if (!this.enabled) return operation(this.prisma);
    return this.prisma.$transaction(async tx => {
      const result = await operation(tx);
      const notification = await event(result, tx);
      if (notification) await this.record(tx, notification);
      return result;
    });
  }

  private scope(user: AuthUser): Prisma.AdminNotificationWhereInput {
    if (!user.roleCodes.includes('ADMIN')) throw new ForbiddenException('Уведомления доступны только администратору.');
    return {
      isDemo: user.isDemo ?? false,
      AND: [
        { clientId: user.clientScopeMode === 'LIMITED' ? { in: user.clientIds } : { notIn: user.hiddenClientIds ?? [] } },
        { clientId: { notIn: user.hiddenClientIds ?? [] } },
        ...(!user.permissionCodes.includes('system:admin') || (user.warehouseIds?.length ?? 0) > 0
          ? [{ warehouseId: { in: user.warehouseIds ?? [] } }] : []),
      ],
    };
  }

  async list(user: AuthUser, beforeId?: number) {
    const scope = this.scope(user);
    if (!this.enabled) return { enabled: false, items: [], popupCandidates: [], unreadCount: 0, nextBeforeId: null };
    const unread = { ...scope, receipts: { none: { userId: user.id, readAt: { not: null } } } };
    const [rows, unreadCount, pending] = await Promise.all([
      this.prisma.adminNotification.findMany({
        where: { ...scope, ...(beforeId ? { id: { lt: beforeId } } : {}) },
        orderBy: { id: 'desc' }, take: 51,
        include: { receipts: { where: { userId: user.id }, select: { readAt: true } } },
      }),
      this.prisma.adminNotification.count({ where: unread }),
      beforeId ? Promise.resolve([]) : this.prisma.adminNotification.findMany({
        where: { ...scope, receipts: { none: { userId: user.id, OR: [{ readAt: { not: null } }, { popupShownAt: { not: null } }] } } },
        orderBy: { id: 'asc' }, take: 3,
      }),
    ]);
    return {
      enabled: true, unreadCount,
      items: rows.slice(0, 50).map(({ receipts, dedupeKey, ...row }) => ({ ...row, isRead: Boolean(receipts[0]?.readAt) })),
      popupCandidates: pending.map(({ dedupeKey, ...row }) => ({ ...row, isRead: false })),
      nextBeforeId: rows.length > 50 ? rows[49].id : null,
    };
  }

  private async visible(id: number, user: AuthUser) {
    const scope = this.scope(user);
    if (!this.enabled || !await this.prisma.adminNotification.findFirst({ where: { ...scope, id }, select: { id: true } })) {
      throw new NotFoundException('Уведомление недоступно.');
    }
  }

  async markRead(id: number, user: AuthUser) {
    await this.visible(id, user);
    await this.prisma.adminNotificationReceipt.upsert({
      where: { notificationId_userId: { notificationId: id, userId: user.id } },
      create: { notificationId: id, userId: user.id, readAt: new Date() }, update: { readAt: new Date() },
    });
    return { isRead: true };
  }

  async claimPopup(id: number, user: AuthUser) {
    await this.visible(id, user);
    // createMany/skipDuplicates handles simultaneous first claims from multiple tabs.
    await this.prisma.adminNotificationReceipt.createMany({ data: [{ notificationId: id, userId: user.id }], skipDuplicates: true });
    const result = await this.prisma.adminNotificationReceipt.updateMany({
      where: { notificationId: id, userId: user.id, popupShownAt: null, readAt: null },
      data: { popupShownAt: new Date() },
    });
    return { claimed: result.count === 1 };
  }
}
