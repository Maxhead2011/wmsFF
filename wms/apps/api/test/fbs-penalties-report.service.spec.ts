import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { FbsPenaltiesReportService } from '../src/modules/marketplace-connections/fbs-penalties-report.service';

const user = {
  id: 'user-1',
  name: 'Администратор',
  activeWarehouseId: 'warehouse-1',
  permissionCodes: ['system:admin'],
} as never;

function createService(rows: Array<Record<string, unknown>>) {
  const prisma = {
    client: {
      findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'LUKIN', name: 'ИП Лукин' }),
    },
    clientMarketplaceConnection: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'connection-1',
          accountName: 'Основной кабинет',
          apiKey: 'secret-wb-token',
        },
      ]),
    },
  };
  const clientScopes = {
    requireClientAccess: vi.fn(),
  };
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return {
    service: new FbsPenaltiesReportService(prisma as never, clientScopes as never),
    prisma,
    clientScopes,
    fetchMock,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FbsPenaltiesReportService', () => {
  it('возвращает только ненулевые штрафы FBS и считает начисления и возвраты', async () => {
    // TEST: FBO/FBW и нулевые строки не должны попадать в 13-ю плитку FBS.
    const { service, clientScopes, fetchMock } = createService([
      {
        rrdId: 101,
        reportId: 5001,
        rrDate: '2026-08-20',
        deliveryMethod: 'FBS, (МГТ)',
        bonusTypeName: 'Штраф МП. Невыполненный заказ',
        penalty: '231.35',
        orderId: 5500000001,
        vendorCode: 'ART-1',
        sku: '2040000000001',
        title: 'Костюм',
        techSize: 'M',
        currency: 'RUB',
      },
      {
        rrdId: 102,
        reportId: 5001,
        rrDate: '2026-08-21',
        deliveryMethod: 'FBS, (МГТ)',
        bonusTypeName: 'Корректировка штрафа',
        penalty: '-31.35',
        orderId: 5500000001,
        currency: 'RUB',
      },
      {
        rrdId: 103,
        deliveryMethod: 'FBW',
        bonusTypeName: 'Чужой штраф FBW',
        penalty: '999',
      },
      {
        rrdId: 104,
        deliveryMethod: 'FBS, (КГТ)',
        bonusTypeName: 'Нулевая строка',
        penalty: '0',
      },
    ]);

    const report = await service.report(
      { clientId: 'client-1', dateFrom: '2026-08-01', dateTo: '2026-08-27' },
      user,
    );

    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(user, 'client-1', 'read');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed',
    );
    expect(report.rows).toHaveLength(2);
    expect(report.summary).toMatchObject({
      penalties: 2,
      chargedPenalty: 231.35,
      reversedPenalty: 31.35,
      netPenalty: 200,
      orders: 1,
    });
    expect(report.reasons).toEqual([
      expect.objectContaining({ reason: 'Штраф МП. Невыполненный заказ', netPenalty: 231.35 }),
      expect.objectContaining({ reason: 'Корректировка штрафа', netPenalty: -31.35 }),
    ]);
  });

  it('переиспользует снимок WB при скачивании Excel и не нарушает минутный лимит', async () => {
    // TEST: экран и Excel должны использовать один кешированный вызов WB.
    const { service, fetchMock } = createService([
      {
        rrdId: 201,
        reportId: 6001,
        rrDate: '2026-08-25',
        deliveryMethod: 'FBS, (МГТ)',
        bonusTypeName: 'Штраф за отмену',
        penalty: '100',
        currency: 'RUB',
        vendorCode: '=1+1',
      },
    ]);

    const filter = { clientId: 'client-1', dateFrom: '2026-08-01', dateTo: '2026-08-27' };
    await service.report(filter, user);
    const file = await service.export(filter, user);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(file.fileName).toContain('FBS_штрафы_LUKIN_2026-08-01_2026-08-27.xlsx');
    expect(file.buffer.length).toBeGreaterThan(1000);
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    // TEST: внешний текст WB не должен выполняться как формула в Excel.
    expect(workbook.Sheets['Штрафы']?.H2?.v).toBe("'=1+1");
  });

  it('объясняет отсутствие финансового доступа токена WB без раскрытия ключа', async () => {
    // TEST: внешний 401 не должен маскироваться и не должен раскрывать API-ключ.
    const { service } = createService([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ title: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(
      service.report(
        { clientId: 'client-1', dateFrom: '2026-08-01', dateTo: '2026-08-27' },
        user,
      ),
    ).rejects.toThrow(/Финансы/u);
    await expect(
      service.report(
        { clientId: 'client-1', dateFrom: '2026-08-01', dateTo: '2026-08-27' },
        user,
      ),
    ).rejects.not.toThrow(/secret-wb-token/u);
  });

  it('показывает данные исправного кабинета и отдельно сообщает ошибку второго', async () => {
    // TEST: один неисправный кабинет не должен скрыть штрафы остальных кабинетов клиента.
    const { service, prisma } = createService([]);
    prisma.clientMarketplaceConnection.findMany.mockResolvedValue([
      { id: 'connection-1', accountName: 'Рабочий кабинет', apiKey: 'token-ok' },
      { id: 'connection-2', accountName: 'Токен без финансов', apiKey: 'token-bad' },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url, init: RequestInit) => {
        const authorization = (init.headers as Record<string, string>).Authorization;
        return authorization === 'token-ok'
          ? Promise.resolve(
              new Response(
                JSON.stringify([
                  {
                    rrdId: 301,
                    deliveryMethod: 'FBS, (МГТ)',
                    bonusTypeName: 'Штраф рабочего кабинета',
                    penalty: '55',
                  },
                ]),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
              ),
            )
          : Promise.resolve(new Response('', { status: 401 }));
      }),
    );

    const report = await service.report(
      { clientId: 'client-1', dateFrom: '2026-08-01', dateTo: '2026-08-27' },
      user,
    );

    expect(report.rows).toHaveLength(1);
    expect(report.sources).toEqual([
      expect.objectContaining({ accountName: 'Рабочий кабинет', status: 'READY' }),
      expect.objectContaining({
        accountName: 'Токен без финансов',
        status: 'ERROR',
        error: expect.stringMatching(/Финансы/u),
      }),
    ]);
  });
});
