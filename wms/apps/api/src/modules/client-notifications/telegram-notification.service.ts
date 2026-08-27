import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

export type TelegramGlobalSettings = {
  enabled: boolean;
  botToken: string;
  fulfillmentChatIds: string[];
  sections: TelegramNotificationSection[];
};

export type TelegramClientSettings = {
  clientId: string;
  enabled: boolean;
  chatId: string;
  sections: TelegramNotificationSection[];
};

export const telegramNotificationSections = [
  'REQUESTS',
  'FBS',
  'WAREHOUSE',
  'LOGISTICS',
  'BILLING',
  'KIZ',
  'SYSTEM',
] as const;

export type TelegramNotificationSection = (typeof telegramNotificationSections)[number];

export type TelegramGroupSummary = {
  id: string;
  title: string;
  type: 'group' | 'supergroup' | 'channel';
  username: string | null;
};

const emptyGlobalSettings: TelegramGlobalSettings = {
  enabled: false,
  botToken: '',
  fulfillmentChatIds: [],
  sections: [...telegramNotificationSections],
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
      sections: normalizeSections(payload.sections),
    };
  }

  async updateGlobalSettings(payload: TelegramGlobalSettings, user: AuthUser) {
    const settings = {
      enabled: payload.enabled === true,
      botToken: payload.botToken.trim(),
      fulfillmentChatIds: payload.fulfillmentChatIds.map((item) => item.trim()).filter(Boolean),
      sections: normalizeSections(payload.sections),
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
      sections: normalizeSections(payload?.sections),
    };
  }

  async updateClientSettings(clientId: string, payload: Omit<TelegramClientSettings, 'clientId'>, user: AuthUser) {
    const settings = {
      clientId,
      enabled: payload.enabled === true,
      chatId: payload.chatId.trim(),
      sections: normalizeSections(payload.sections),
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

  async notifyClient(clientId: string, text: string, section: TelegramNotificationSection = inferNotificationSection(text)) {
    const [global, client] = await Promise.all([this.getGlobalSettings(), this.getClientSettings(clientId)]);
    if (!global.enabled || !global.botToken || !client.enabled || !client.chatId) {
      return { sent: false, reason: 'Telegram выключен или chat_id клиента не заполнен.' };
    }
    if (!client.sections.includes(section)) {
      return { sent: false, reason: 'Раздел отключен в настройках Telegram клиента.' };
    }

    return this.sendMessage(global.botToken, client.chatId, text);
  }

  async notifyFulfillment(text: string, section: TelegramNotificationSection = inferNotificationSection(text)) {
    const global = await this.getGlobalSettings();
    if (!global.enabled || !global.botToken || global.fulfillmentChatIds.length === 0) {
      return { sent: false, reason: 'Telegram для фулфилмента выключен или чаты не заполнены.' };
    }
    if (!global.sections.includes(section)) {
      return { sent: false, reason: 'Раздел отключен в настройках Telegram фулфилмента.' };
    }

    const results = [];
    for (const chatId of global.fulfillmentChatIds) {
      results.push(await this.sendMessage(global.botToken, chatId, text));
    }

    return { sent: results.some((result) => result.sent), results };
  }

  async sendTestToClient(clientId: string) {
    const [global, client] = await Promise.all([this.getGlobalSettings(), this.getClientSettings(clientId)]);
    if (!global.enabled || !global.botToken || !client.enabled || !client.chatId) {
      return { sent: false, reason: 'Telegram выключен или группа клиента не заполнена.' };
    }
    return this.sendMessage(global.botToken, client.chatId, 'LOGOFF WMS: тестовое уведомление для клиента.');
  }

  async sendTestToFulfillment() {
    const global = await this.getGlobalSettings();
    if (!global.enabled || !global.botToken || global.fulfillmentChatIds.length === 0) {
      return { sent: false, reason: 'Telegram для фулфилмента выключен или группы не заполнены.' };
    }
    const results = [];
    for (const chatId of global.fulfillmentChatIds) {
      results.push(await this.sendMessage(global.botToken, chatId, 'LOGOFF WMS: тестовое уведомление для фулфилмента.'));
    }
    return { sent: results.some((result) => result.sent), results };
  }

  async listAvailableGroups(): Promise<{ groups: TelegramGroupSummary[]; warning?: string }> {
    const global = await this.getGlobalSettings();
    if (!global.botToken) {
      return { groups: [], warning: 'Сначала сохраните Bot token.' };
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${global.botToken}/getUpdates`);
      if (!response.ok) {
        return { groups: [], warning: await telegramErrorReason(response) };
      }
      const payload = (await response.json()) as { result?: unknown };
      const groups = collectTelegramGroups(payload.result);
      return {
        groups,
        warning: groups.length === 0 ? 'Бот пока не видит групп. Добавьте его в группу и отправьте там любое сообщение.' : undefined,
      };
    } catch (error) {
      return { groups: [], warning: error instanceof Error ? error.message : 'Не удалось получить группы Telegram.' };
    }
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

function normalizeSections(value: unknown): TelegramNotificationSection[] {
  if (!Array.isArray(value)) {
    return [...telegramNotificationSections];
  }
  return telegramNotificationSections.filter((section) => value.includes(section));
}

function collectTelegramGroups(value: unknown): TelegramGroupSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const groups = new Map<string, TelegramGroupSummary>();
  for (const rawUpdate of value) {
    const update = asRecord(rawUpdate);
    if (!update) {
      continue;
    }
    const candidates = [
      asRecord(asRecord(update.message)?.chat),
      asRecord(asRecord(update.edited_message)?.chat),
      asRecord(asRecord(update.channel_post)?.chat),
      asRecord(asRecord(update.edited_channel_post)?.chat),
      asRecord(asRecord(update.my_chat_member)?.chat),
      asRecord(asRecord(update.chat_member)?.chat),
    ];
    for (const chat of candidates) {
      if (!chat) {
        continue;
      }
      const type = chat.type;
      const id = chat.id;
      if ((type !== 'group' && type !== 'supergroup' && type !== 'channel') || (typeof id !== 'string' && typeof id !== 'number')) {
        continue;
      }
      const normalizedId = String(id);
      groups.set(normalizedId, {
        id: normalizedId,
        title: typeof chat.title === 'string' && chat.title.trim() ? chat.title.trim() : `Telegram ${normalizedId}`,
        type,
        username: typeof chat.username === 'string' ? chat.username : null,
      });
    }
  }

  return [...groups.values()].sort((left, right) => left.title.localeCompare(right.title, 'ru'));
}

function inferNotificationSection(text: string): TelegramNotificationSection {
  const normalized = text.toLocaleLowerCase('ru-RU');
  if (/(киз|маркиров)/u.test(normalized)) {
    return 'KIZ';
  }
  if (/(счет|счёт|оплат|аванс|долг|биллинг)/u.test(normalized)) {
    return 'BILLING';
  }
  if (/(достав|логист|курьер|машин)/u.test(normalized)) {
    return 'LOGISTICS';
  }
  if (/(fbs|фбс|wildberries|ozon|маркетплейс|волна|сборк)/u.test(normalized)) {
    return 'FBS';
  }
  if (/(приемк|приёмк|склад|остат|короб|палет|ячейк)/u.test(normalized)) {
    return 'WAREHOUSE';
  }
  if (/(заявк|комментар|файл)/u.test(normalized)) {
    return 'REQUESTS';
  }
  return 'SYSTEM';
}
