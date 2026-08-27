import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientNotificationEvent, ClientRequestEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { isClientNotificationEnabled } from '../client-notifications/client-notification-preferences';
import { TelegramNotificationService } from '../client-notifications/telegram-notification.service';
import { manualPickInstructionPlanFilePrefix } from '../stock/manual-pick-instruction';
import { assertWarehouseAccess } from './client-request-warehouse-scope';

const maxFileSizeBytes = 10 * 1024 * 1024;

@Injectable()
export class ClientRequestFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly telegram?: TelegramNotificationService,
  ) {}

  async listForRequest(requestId: string, user: AuthUser) {
    const request = await this.getRequestForAccess(requestId);
    this.clientScopes.requireClientAccess(user, request.clientId, 'read');
    assertWarehouseAccess(user, request, 'read', 'Заявка не найдена в выбранном филиале.');

    const files = await this.prisma.clientRequestFile.findMany({
      where: { requestId, NOT: { fileName: { startsWith: manualPickInstructionPlanFilePrefix } } },
      select: clientRequestFileSummarySelect,
      orderBy: { createdAt: 'desc' },
    });
    return files.map((file) => ({ ...file, fileName: normalizeFileName(file.fileName) }));
  }

  async uploadToRequest(requestId: string, file: Express.Multer.File | undefined, user: AuthUser) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Файл не передан.');
    }

    if (file.size > maxFileSizeBytes) {
      throw new BadRequestException('Файл больше 10 МБ.');
    }

    const request = await this.getRequestForAccess(requestId);
    this.clientScopes.requireClientAccess(user, request.clientId, 'write');
    assertWarehouseAccess(user, request, 'write', 'Заявка не найдена в выбранном филиале.');
    const notifyClient = await isClientNotificationEnabled(this.prisma, request.clientId, ClientNotificationEvent.REQUEST_FILE_UPLOADED);

    // Русский комментарий: файл хранится рядом с заявкой, чтобы клиент видел вложения без внешнего файлового сервиса.
    const savedFile = await this.prisma.$transaction(async (tx) => {
      const savedFile = await tx.clientRequestFile.create({
        data: {
          requestId,
          clientId: request.clientId,
          fileName: normalizeFileName(file.originalname),
          mimeType: file.mimetype || 'application/octet-stream',
          sizeBytes: file.size,
          content: Uint8Array.from(file.buffer),
          uploadedByUserId: user.id,
        },
        select: clientRequestFileSummarySelect,
      });

      if (notifyClient) {
        await tx.clientNotification.create({
          data: {
            clientId: request.clientId,
            requestId,
            title: 'Добавлен файл к заявке',
            body: `${savedFile.fileName} · ${request.title}`,
            severity: 'INFO',
            createdByUserId: user.id,
          },
        });
      }

      await tx.clientRequestEvent.create({
        data: {
          requestId,
          clientId: request.clientId,
          eventType: ClientRequestEventType.FILE_UPLOADED,
          title: 'Файл приложен к заявке',
          body: savedFile.fileName,
          createdByUserId: user.id,
        },
      });

      return savedFile;
    });

    if (notifyClient) {
      void this.telegram?.notifyClient(
        request.clientId,
        ['LOGOFF WMS: файл добавлен к заявке.', `Заявка: ${request.title}`, `Файл: ${savedFile.fileName}`].join('\n'),
      );
    }

    return savedFile;
  }

  async getFileContent(requestId: string, fileId: string, user: AuthUser) {
    const request = await this.getRequestForAccess(requestId);
    this.clientScopes.requireClientAccess(user, request.clientId, 'read');
    assertWarehouseAccess(user, request, 'read', 'Заявка не найдена в выбранном филиале.');
    const file = await this.prisma.clientRequestFile.findFirst({
      where: { id: fileId, requestId },
      select: {
        ...clientRequestFileSummarySelect,
        content: true,
      },
    });

    if (!file) {
      throw new NotFoundException('Файл заявки не найден.');
    }

    if (file.fileName.startsWith(manualPickInstructionPlanFilePrefix)) {
      throw new NotFoundException('Файл заявки не найден.');
    }

    return { ...file, fileName: normalizeFileName(file.fileName) };
  }

  private async getRequestForAccess(requestId: string) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: { id: true, clientId: true, warehouseId: true, title: true },
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    return request;
  }
}

export const clientRequestFileSummarySelect = {
  id: true,
  requestId: true,
  clientId: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  uploadedByUserId: true,
  createdAt: true,
  uploadedBy: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} satisfies Prisma.ClientRequestFileSelect;

function normalizeFileName(value?: string) {
  const source = value?.trim() ?? '';
  const mojibakeStart = source.search(/[ÃÐÑ]/);
  const decoded =
    mojibakeStart >= 0
      ? `${source.slice(0, mojibakeStart)}${Buffer.from(source.slice(mojibakeStart), 'latin1').toString('utf8')}`
      : source;
  const readable = decoded.includes('�') ? source : decoded;
  const normalized = readable.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return normalized || 'attachment.bin';
}
