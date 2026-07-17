import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { RequestBillingAutomationService } from '../src/modules/billing/request-billing-automation.service';

describe('RequestBillingAutomationService', () => {
  it('создает черновики услуг и логистики после закрытия заявки', async () => {
    const createdInvoices: Array<Record<string, unknown>> = [];
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          clientId: 'client-1',
          title: 'Поставка в Казань',
          updatedAt: new Date('2026-07-11T12:00:00.000Z'),
          client: { logisticsInvoiceMode: 'SEPARATE' },
        }),
      },
      billingCharge: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'charge-service',
            clientId: 'client-1',
            requestId: 'request-1',
            description: 'Обработка товара',
            unit: 'PIECE',
            quantity: 100,
            unitPriceRub: 12,
            totalRub: 1200,
            serviceDate: new Date('2026-07-11T10:00:00.000Z'),
            source: 'MANUAL',
          },
          {
            id: 'charge-logistics',
            clientId: 'client-1',
            requestId: 'request-1',
            description: 'Логистика Москва - Казань',
            unit: 'SERVICE',
            quantity: 1,
            unitPriceRub: 5000,
            totalRub: 5000,
            serviceDate: new Date('2026-07-11T10:00:00.000Z'),
            source: 'LOGISTICS',
          },
        ]),
      },
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          createdInvoices.push(data);
          return Promise.resolve({ id: `invoice-${createdInvoices.length}` });
        }),
      },
    };
    const service = new RequestBillingAutomationService(prisma as never);

    await expect(service.generateForDoneRequest('request-1', user())).resolves.toMatchObject({
      status: 'APPLIED',
      created: 2,
    });

    expect(createdInvoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          number: 'USL-202607-0001',
          status: 'DRAFT',
          source: 'REQUEST_DONE',
          sourceKey: 'request:request-1:services',
          totalRub: 1200,
        }),
        expect.objectContaining({
          number: 'LOG-202607-0001',
          status: 'DRAFT',
          source: 'LOGISTICS',
          sourceKey: 'request:request-1:logistics',
          totalRub: 5000,
        }),
      ]),
    );
  });
});

function user(): AuthUser {
  return {
    id: 'user-1',
    email: 'admin@logoff.pro',
    name: 'Администратор',
    roleCodes: ['ADMIN'],
    permissionCodes: ['system:admin'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
  };
}
