import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, TsdOperationStatus } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

const TYPE = 'monitor_message';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

// ADDED: durable messages reuse the operation journal; no inventory/status commands.
// reviewedAt records an explicit recipient acknowledgement, never heartbeat delivery.
export class TsdMonitorMessages {
  constructor(private readonly prisma: PrismaService) {}

  private assertDispatcher(user: AuthUser) {
    if (!user.administrationEnabled || !user.permissionCodes.includes('system:admin') || user.isDemo || user.roleCodes.includes('CLIENT')) {
      throw new ForbiddenException('Отправка сообщений ТСД доступна только диспетчеру WMS.');
    }
  }

  private async target(code: string) {
    if (!code || code.length > 200) throw new BadRequestException('Укажите ТСД из мониторинга.');
    const heartbeat = await this.prisma.tsdOperation.findFirst({
      where: { operationType: 'monitor_heartbeat', OR: [
        { deviceId: code }, { deviceId: { startsWith: `${code}@` } },
      ] },
      orderBy: { updatedAt: 'desc' },
      select: { deviceId: true, payload: true },
    });
    if (!heartbeat) throw new NotFoundException('ТСД не подключен к мониторингу.');
    return heartbeat;
  }

  async send(code: string, body: { text?: unknown; requestId?: unknown }, user: AuthUser) {
    this.assertDispatcher(user);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 2000) throw new BadRequestException('Сообщение должно содержать от 1 до 2000 символов.');
    if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.requestId)) {
      throw new BadRequestException('Некорректный идентификатор отправки.');
    }
    const target = await this.target(code);
    const state = record(target.payload);
    if (state.monitorMessages !== true) throw new BadRequestException('Обновите приложение на этом ТСД: текущая версия не поддерживает сообщения.');
    if (typeof state.workerUserId !== 'string' || !state.workerUserId) throw new BadRequestException('На ТСД не определён сотрудник.');
    const operation = await this.prisma.tsdOperation.upsert({
      where: { operationKey: `monitor-message:${user.id}:${body.requestId}` },
      update: {},
      create: {
        deviceId: target.deviceId, operationKey: `monitor-message:${user.id}:${body.requestId}`,
        operationType: TYPE, status: TsdOperationStatus.ACCEPTED, reviewedAt: null,
        payload: { text, issuedBy: user.id, senderName: user.name, recipientUserId: state.workerUserId },
      },
    });
    const saved = record(operation.payload);
    if (operation.deviceId !== target.deviceId || saved.text !== text || saved.recipientUserId !== state.workerUserId) {
      throw new BadRequestException('Эта отправка уже выполнена для другого текста или сотрудника. Обновите окно сообщений.');
    }
    return this.view(operation);
  }

  async list(code: string, user: AuthUser) {
    this.assertDispatcher(user);
    const target = await this.target(code);
    const messages = await this.prisma.tsdOperation.findMany({
      where: { operationType: TYPE, OR: [{ deviceId: code }, { deviceId: { startsWith: `${code}@` } }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
    });
    return { supported: record(target.payload).monitorMessages === true, messages: messages.map(row => this.view(row)) };
  }

  // FIX: identity comes from authenticated token, not user-supplied installationCode.
  private deviceCode(user: AuthUser) {
    const code = (user.deviceCode ?? '').trim().toUpperCase();
    return !code ? '' : /^FFU-TSD-/.test(code) ? code : `${code}@${user.id.slice(0, 8).toUpperCase()}`;
  }

  async next(deviceCode: string, user: AuthUser) {
    if (!deviceCode || deviceCode !== this.deviceCode(user)) return null;
    const row = await this.prisma.tsdOperation.findFirst({
      where: { deviceId: deviceCode, operationType: TYPE, reviewedAt: null,
        payload: { path: ['recipientUserId'], equals: user.id } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return row ? this.view(row) : null;
  }

  async ack(id: string, user: AuthUser) {
    const row = await this.prisma.tsdOperation.findUnique({ where: { id } });
    if (!row || row.operationType !== TYPE || row.deviceId !== this.deviceCode(user) || record(row.payload).recipientUserId !== user.id) {
      throw new ForbiddenException('Нельзя подтвердить сообщение другого ТСД или сотрудника.');
    }
    if (!row.reviewedAt) await this.prisma.tsdOperation.updateMany({
      where: { id, reviewedAt: null }, data: { reviewedAt: new Date(), reviewedByUserId: user.id },
    });
    return { accepted: true };
  }

  private view(row: { id: string; payload: Prisma.JsonValue; createdAt: Date; reviewedAt: Date | null }) {
    const payload = record(row.payload);
    return { id: row.id, text: String(payload.text ?? ''), senderName: String(payload.senderName ?? ''),
      recipientUserId: String(payload.recipientUserId ?? ''), createdAt: row.createdAt.toISOString(), readAt: row.reviewedAt?.toISOString() ?? null };
  }
}
