import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { ClientsService } from '../src/modules/clients/clients.service';

describe('ClientsService', () => {
  it('обновляет реквизиты клиента и очищает пустые поля', async () => {
    const prisma = {
      client: {
        update: vi.fn().mockResolvedValue({ id: 'client-1', code: 'CLIENT', name: 'ООО Клиент' }),
      },
    };
    const scopes = {
      requireGlobalClientAccess: vi.fn(),
    };
    const service = new ClientsService(prisma as never, scopes as never);

    await service.update(
      'client-1',
      {
        name: ' ООО Клиент ',
        legalName: ' ООО "Клиент" ',
        email: '',
        bankAccount: ' 40702810000000000001 ',
        fbsCalculatorEnabled: true,
      },
      user(),
    );

    expect(scopes.requireGlobalClientAccess).toHaveBeenCalledWith(expect.any(Object));
    expect(prisma.client.update).toHaveBeenCalledWith({
      where: { id: 'client-1' },
      data: {
        name: 'ООО Клиент',
        legalName: 'ООО "Клиент"',
        email: null,
        bankAccount: '40702810000000000001',
        fbsCalculatorEnabled: true,
      },
      select: expect.objectContaining({
        code: true,
        clientKind: true,
        fbsCalculatorEnabled: true,
        fulfillmentManagerUserId: true,
      }),
    });
  });

  it('генерирует код клиента и сохраняет обязательные реквизиты', async () => {
    const prisma = {
      client: {
        findFirst: vi.fn().mockResolvedValue({ code: 'CL-000041' }),
        create: vi.fn().mockResolvedValue({ id: 'client-42', code: 'CL-000042', name: 'Клиент' }),
      },
    };
    const scopes = {
      requireGlobalClientAccess: vi.fn(),
    };
    const service = new ClientsService(prisma as never, scopes as never);

    await service.create(
      {
        clientKind: 'LEGAL_ENTITY',
        name: ' Клиент ',
        legalName: ' ООО Клиент ',
        inn: ' 7700000000 ',
      },
      user(),
    );

    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'CL-000042',
          clientKind: 'LEGAL_ENTITY',
          name: 'Клиент',
          legalName: 'ООО Клиент',
          inn: '7700000000',
        }),
      }),
    );
  });

  it('загружает клиентов из Excel по наименованию, дате регистрации и коду', async () => {
    const createdAt = new Date(Date.UTC(2026, 3, 1));
    const prisma = {
      client: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'client-1', code: 'BAL', name: 'Баланс' }),
      },
    };
    const scopes = {
      requireGlobalClientAccess: vi.fn(),
    };
    const service = new ClientsService(prisma as never, scopes as never);

    const result = await service.importWorkbook(
      excelFile([
        ['Наименование', 'Дата регистрации', 'Код'],
        ['Баланс', createdAt, 'BAL'],
      ]),
      user(),
    );

    expect(result.summary.created).toBe(1);
    expect(result.summary.errors).toBe(0);
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'BAL',
          clientKind: 'LEGAL_ENTITY',
          name: 'Баланс',
          legalName: 'Баланс',
          createdAt,
        }),
      }),
    );
  });

  it('пропускает клиента из Excel, если код уже есть в базе', async () => {
    const prisma = {
      client: {
        findMany: vi.fn().mockResolvedValue([{ code: 'BAL', name: 'Баланс старый' }]),
        create: vi.fn(),
      },
    };
    const scopes = {
      requireGlobalClientAccess: vi.fn(),
    };
    const service = new ClientsService(prisma as never, scopes as never);

    const result = await service.importWorkbook(
      excelFile([
        ['Наименование', 'Дата регистрации', 'Код'],
        ['Баланс', '01.04.2026', 'BAL'],
      ]),
      user(),
    );

    expect(result.summary.created).toBe(0);
    expect(result.summary.skipped).toBe(1);
    expect(result.issues[0]).toEqual(
      expect.objectContaining({
        row: 2,
        code: 'BAL',
        severity: 'warning',
      }),
    );
    expect(prisma.client.create).not.toHaveBeenCalled();
  });

  it('блокирует клиента через статус PAUSED', async () => {
    const prisma = {
      client: {
        update: vi.fn().mockResolvedValue({ id: 'client-1', code: 'CLIENT', name: 'Клиент', status: 'PAUSED' }),
      },
    };
    const scopes = {
      requireGlobalClientAccess: vi.fn(),
    };
    const service = new ClientsService(prisma as never, scopes as never);

    const result = await service.updateStatus('client-1', 'PAUSED', user());

    expect(result.status).toBe('PAUSED');
    expect(prisma.client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'client-1' },
        data: { status: 'PAUSED' },
      }),
    );
  });

  it('удаляет клиента без рабочих данных и очищает безопасные привязки', async () => {
    const operations = ['delete-user-scopes', 'delete-notification-preferences', 'delete-client'];
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'CLIENT', name: 'Клиент', _count: emptyClientCounts() }),
        delete: vi.fn().mockReturnValue(operations[2]),
      },
      userClient: {
        deleteMany: vi.fn().mockReturnValue(operations[0]),
      },
      clientNotificationPreference: {
        deleteMany: vi.fn().mockReturnValue(operations[1]),
      },
      $transaction: vi.fn().mockResolvedValue(undefined),
    };
    const scopes = {
      requireGlobalClientAccess: vi.fn(),
    };
    const service = new ClientsService(prisma as never, scopes as never);

    const result = await service.delete('client-1', user());

    expect(result).toEqual({
      id: 'client-1',
      code: 'CLIENT',
      name: 'Клиент',
      deleted: true,
    });
    expect(prisma.userClient.deleteMany).toHaveBeenCalledWith({ where: { clientId: 'client-1' } });
    expect(prisma.clientNotificationPreference.deleteMany).toHaveBeenCalledWith({ where: { clientId: 'client-1' } });
    expect(prisma.client.delete).toHaveBeenCalledWith({ where: { id: 'client-1' } });
    expect(prisma.$transaction).toHaveBeenCalledWith(operations);
  });

  it('не удаляет клиента, если есть связанные рабочие данные', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'client-1',
          code: 'CLIENT',
          name: 'Клиент',
          _count: { ...emptyClientCounts(), skus: 2 },
        }),
        delete: vi.fn(),
      },
      userClient: {
        deleteMany: vi.fn(),
      },
      clientNotificationPreference: {
        deleteMany: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    const scopes = {
      requireGlobalClientAccess: vi.fn(),
    };
    const service = new ClientsService(prisma as never, scopes as never);

    await expect(service.delete('client-1', user())).rejects.toThrow('Клиента нельзя удалить');

    expect(prisma.client.delete).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function excelFile(rows: unknown[][]): Express.Multer.File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Клиенты');
  return {
    originalname: 'clients.xlsx',
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  } as Express.Multer.File;
}

function user(): AuthUser {
  return {
    id: 'user-1',
    email: 'admin@example.com',
    name: 'Admin',
    roleCodes: ['ADMIN'],
    permissionCodes: ['clients:write'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };
}

function emptyClientCounts() {
  return {
    skus: 0,
    boxes: 0,
    pallets: 0,
    movements: 0,
    requests: 0,
    billingCharges: 0,
    billingInvoices: 0,
    billingPayments: 0,
    deliveryRequests: 0,
    requestFiles: 0,
    requestPackages: 0,
    notifications: 0,
    productMarks: 0,
    requestComments: 0,
    requestEvents: 0,
  };
}
