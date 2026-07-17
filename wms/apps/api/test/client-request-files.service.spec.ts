import { ForbiddenException } from '@nestjs/common';
import { ClientRequestEventType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { ClientRequestFilesService } from '../src/modules/client-requests/client-request-files.service';

describe('ClientRequestFilesService', () => {
  it('восстанавливает русское имя ранее сохраненного файла', async () => {
    const prefix = '\u0410\u0432\u0430\u0440\u0438\u0439\u043d\u0430\u044f \u0443\u043f\u0430\u043a\u043e\u0432\u043a\u0430 - ';
    const suffix = '\u0421\u0442\u0430\u043b\u044c 7.07.xlsx';
    const brokenName = `${prefix}${Buffer.from(suffix, 'utf8').toString('latin1')}`;
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({ id: 'request-1', clientId: 'client-1', title: 'Отгрузка' }),
      },
      clientRequestFile: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'file-1',
            requestId: 'request-1',
            clientId: 'client-1',
            fileName: brokenName,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeBytes: 4,
            uploadedByUserId: 'user-1',
            createdAt: new Date('2026-07-12T00:00:00Z'),
            uploadedBy: null,
          },
        ]),
      },
    };
    const service = new ClientRequestFilesService(prisma as never, new ClientScopeService());

    await expect(
      service.listForRequest(
        'request-1',
        user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
      ),
    ).resolves.toEqual([expect.objectContaining({ fileName: `${prefix}${suffix}` })]);
  });

  it('сохраняет файл заявки и создает уведомление клиенту', async () => {
    const tx = {
      clientRequestFile: {
        create: vi.fn().mockResolvedValue({
          id: 'file-1',
          requestId: 'request-1',
          clientId: 'client-1',
          fileName: 'invoice.pdf',
          sizeBytes: 4,
        }),
      },
      clientNotification: {
        create: vi.fn().mockResolvedValue({ id: 'notification-1' }),
      },
      clientNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      clientRequestEvent: {
        create: vi.fn().mockResolvedValue({ id: 'event-1' }),
      },
    };
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          title: 'Отгрузка',
        }),
      },
      clientNotificationPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new ClientRequestFilesService(prisma as never, new ClientScopeService());

    await service.uploadToRequest(
      'request-1',
      multerFile({ originalname: 'invoice.pdf', buffer: Buffer.from('test'), size: 4 }),
      user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
    );

    expect(tx.clientRequestFile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: 'request-1',
          clientId: 'client-1',
          fileName: 'invoice.pdf',
          content: Uint8Array.from(Buffer.from('test')),
        }),
      }),
    );
    expect(tx.clientNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          requestId: 'request-1',
          title: 'Добавлен файл к заявке',
        }),
      }),
    );
    expect(tx.clientRequestEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: 'request-1',
          eventType: ClientRequestEventType.FILE_UPLOADED,
          body: 'invoice.pdf',
        }),
      }),
    );
  });

  it('не дает загрузить файл в заявку недоступного клиента', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-foreign',
          title: 'Чужая заявка',
        }),
      },
    };
    const service = new ClientRequestFilesService(prisma as never, new ClientScopeService());

    await expect(
      service.uploadToRequest(
        'request-1',
        multerFile({ originalname: 'box.xlsx', buffer: Buffer.from('test'), size: 4 }),
        user({ clientIds: ['client-1'], writableClientIds: ['client-1'] }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

function multerFile(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'file.txt',
    encoding: '7bit',
    mimetype: 'text/plain',
    size: 0,
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    buffer: Buffer.alloc(0),
    ...overrides,
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
