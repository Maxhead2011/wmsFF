import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

export type TelegramGlobalSettings = {
  enabled: boolean;
  botToken: string;
  fulfillmentChatIds: string[];
};

export type TelegramClientSettings = {
  clientId: string;
  enabled: boolean;
  chatId: string;
};

const emptyGlobalSettings: TelegramGlobalSettings = {
  enabled: false,
  botToken: '',
  fulfillmentChatIds: [],
};

@Injectable()
export class TelegramNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async getGlobalSettings(): Promise<TelegramGlobalSettings> {
    const event = await this.prisma.auditLog.findFirst({
      where: { action: 'service.telegram.global.update', entity: 'telegram' },
      orderBy: { createdAt: 'desc' },
    });

    const payload = asRecord(event?.payload);
    if (!payload) {
      return {
        ...emptyGlobalSettings,
        botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
      };
    }

    return {
      enabled: payload.enabled === true,
      botToken: typeof payload.botToken === 'string' ? payload.botToken : process.env.TELEGRAM_BOT_TOKEN ?? '',
      fulfillmentChatIds: Array.isArray(payload.fulfillmentChatIds)
        ? payload.fulfillmentChatIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [],
    };
  }

  async updateGlobalSettings(payload: TelegramGlobalSettings, user: AuthUser) {
    const settings = {
      enabled: payload.enabled === true,
      botToken: payload.botToken.trim(),
      fulfillmentChatIds: payload.fulfillmentChatIds.map((item) => item.trim()).filter(Boolean),
    };

    await this.auditLog.write({
      userId: user.id,
      action: 'service.telegram.global.update',
      entity: 'telegram',
      payload: settings,
    });

    return settings;
  }

  async getClientSettings(clientId: string): Promise<TelegramClientSettings> {
    const event = await this.prisma.auditLog.findFirst({
      where: { action: 'service.telegram.client.update', entity: 'client', entityId: clientId },
      orderBy: { createdAt: 'desc' },
    });
    const payload = asRecord(event?.payload);

    return {
      clientId,
      enabled: payload?.enabled === true,
      chatId: typeof payload?.chatId === 'string' ? payload.chatId : '',
    };
  }

  async updateClientSettings(clientId: string, payload: Omit<TelegramClientSettings, 'clientId'>, user: AuthUser) {
    const settings = {
      clientId,
      enabled: payload.enabled === true,
      chatId: payload.chatId.trim(),
    };

    await this.auditLog.write({
      userId: user.id,
      action: 'service.telegram.client.update',
      entity: 'client',
      entityId: clientId,
      payload: settings,
    });

    return settings;
  }

  async notifyClient(clientId: string, text: string) {
    const [global, client] = await Promise.all([this.getGlobalSettings(), this.getClientSettings(clientId)]);
    if (!global.enabled || !global.botToken || !client.enabled || !client.chatId) {
      return { sent: false, reason: 'Telegram выключен или chat_id клиента не заполнен.' };
    }

    return this.sendMessage(global.botToken, client.chatId, text);
  }

  async notifyFulfillment(text: string) {
    const global = await this.getGlobalSettings();
    if (!global.enabled || !global.botToken || global.fulfillmentChatIds.length === 0) {
      return { sent: false, reason: 'Telegram для фулфилмента выключен или чаты не заполнены.' };
    }

    const results = [];
    for (const chatId of global.fulfillmentChatIds) {
      results.push(await this.sendMessage(global.botToken, chatId, text));
    }

    return { sent: results.some((result) => result.sent), results };
  }

  async sendTestToClient(clientId: string) {
    return this.notifyClient(clientId, 'LOGOFF WMS: тестовое уведомление для клиента.');
  }

  async sendTestToFulfillment() {
    return this.notifyFulfillment('LOGOFF WMS: тестовое уведомление для фулфилмента.');
  }

  private async sendMessage(botToken: string, chatId: string, text: string) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        return { sent: false, reason: await telegramErrorReason(response) };
      }

      return { sent: true };
    } catch (error) {
      return { sent: false, reason: error instanceof Error ? error.message : 'Не удалось отправить Telegram.' };
    }
  }
}

async function telegramErrorReason(response: Response) {
  try {
    const payload = (await response.json()) as { description?: unknown };
    const description = typeof payload.description === 'string' ? payload.description : '';
    return description ? `Telegram HTTP ${response.status}: ${description}` : `Telegram HTTP ${response.status}`;
  } catch {
    return `Telegram HTTP ${response.status}`;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
