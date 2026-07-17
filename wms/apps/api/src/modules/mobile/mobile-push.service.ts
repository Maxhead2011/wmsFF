import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class MobilePushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MobilePushService.name);
  private timer?: NodeJS.Timeout;
  private messaging?: Messaging;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.messaging = this.createMessaging();
    if (!this.messaging) {
      this.logger.warn('FCM отключен: задайте FIREBASE_SERVICE_ACCOUNT_JSON.');
      return;
    }
    this.timer = setInterval(() => void this.dispatch(), 10_000);
    this.timer.unref();
    void this.dispatch();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch() {
    if (!this.messaging || this.running) return;
    this.running = true;
    try {
      const notifications = await this.prisma.clientNotification.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      for (const notification of notifications) {
        const devices = await this.prisma.mobileDevice.findMany({
          where: {
            isActive: true,
            fcmToken: { not: null },
            pushDeliveries: { none: { notificationId: notification.id } },
            user: {
              status: 'ACTIVE',
              OR: [
                { clientScopes: { some: { clientId: notification.clientId, canRead: true } } },
                { roles: { some: { role: { code: { in: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'] } } } } },
              ],
            },
          },
          select: { id: true, fcmToken: true },
        });
        for (const device of devices) await this.send(notification, device.id, device.fcmToken!);
      }
    } catch (error) {
      this.logger.error(`Ошибка очереди FCM: ${errorText(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async send(
    notification: { id: string; clientId: string; requestId: string | null; title: string; body: string | null },
    deviceId: string,
    token: string,
  ) {
    try {
      await this.messaging!.send({
        token,
        notification: { title: notification.title, body: notification.body ?? '' },
        data: {
          notificationId: notification.id,
          clientId: notification.clientId,
          requestId: notification.requestId ?? '',
          type: notification.requestId ? 'REQUEST' : 'GENERAL',
        },
        android: { priority: 'high', notification: { channelId: 'wms_events', sound: 'default' } },
      });
      await this.prisma.mobilePushDelivery.create({ data: { deviceId, notificationId: notification.id, status: 'SENT' } });
    } catch (error) {
      const message = errorText(error);
      await this.prisma.mobilePushDelivery.create({
        data: { deviceId, notificationId: notification.id, status: 'FAILED', error: message.slice(0, 500) },
      }).catch(() => undefined);
      if (message.includes('registration-token-not-registered') || message.includes('invalid-registration-token')) {
        await this.prisma.mobileDevice.update({ where: { id: deviceId }, data: { isActive: false, fcmToken: null } });
      }
    }
  }

  private createMessaging() {
    const raw = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (!raw) return undefined;
    try {
      const serviceAccount = JSON.parse(raw) as Record<string, string>;
      const app = getApps().length ? getApp() : initializeApp({ credential: cert(serviceAccount) });
      return getMessaging(app);
    } catch (error) {
      this.logger.error(`FIREBASE_SERVICE_ACCOUNT_JSON не читается: ${errorText(error)}`);
      return undefined;
    }
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
