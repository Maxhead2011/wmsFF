import { BillingInvoiceStatus } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import type { BillingPrintableDocument } from '../src/modules/billing/billing-document.service';
import { BillingPdfService } from '../src/modules/billing/billing-pdf.service';

describe('BillingPdfService', () => {
  it('формирует PDF счета из печатного снимка', async () => {
    const documents = {
      getInvoiceDocument: vi.fn().mockResolvedValue(printableDocument()),
      getInvoiceActDocument: vi.fn(),
    };
    const service = new BillingPdfService(documents as never);

    const file = await service.getInvoicePdf('invoice-1', user());

    expect(documents.getInvoiceDocument).toHaveBeenCalledWith('invoice-1', expect.any(Object));
    expect(file.fileName).toBe('INV-202606-0001.pdf');
    expect(file.contentType).toBe('application/pdf');
    expect(file.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(file.buffer.length).toBeGreaterThan(4000);
  });

  it('формирует PDF акта из того же снимка счета', async () => {
    const documents = {
      getInvoiceDocument: vi.fn(),
      getInvoiceActDocument: vi.fn().mockResolvedValue({
        ...printableDocument(),
        documentKind: 'act',
        actNumber: 'ACT-202606-0001',
        title: 'Акт № ACT-202606-0001 оказанных услуг',
        fileName: 'ACT-202606-0001.html',
      }),
    };
    const service = new BillingPdfService(documents as never);

    const file = await service.getInvoiceActPdf('invoice-1', user());

    expect(documents.getInvoiceActDocument).toHaveBeenCalledWith('invoice-1', expect.any(Object));
    expect(file.fileName).toBe('ACT-202606-0001.pdf');
    expect(file.buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('объединяет счета одного клиента в один многостраничный PDF', async () => {
    const documents = {
      getInvoiceDocument: vi.fn().mockImplementation((invoiceId: string) =>
        Promise.resolve({
          ...printableDocument(),
          invoiceId,
          number: invoiceId === 'invoice-1' ? 'INV-202606-0001' : 'INV-202607-0002',
          fileName: invoiceId === 'invoice-1' ? 'INV-202606-0001.html' : 'INV-202607-0002.html',
        }),
      ),
      getInvoiceActDocument: vi.fn(),
    };
    const service = new BillingPdfService(documents as never);

    const file = await service.getCombinedInvoicesPdf(['invoice-1', 'invoice-2'], 'CLIENT', user());
    const merged = await PDFDocument.load(file.buffer);

    expect(documents.getInvoiceDocument).toHaveBeenCalledTimes(2);
    expect(file.fileName).toMatch(/^Счета_CLIENT_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(file.contentType).toBe('application/pdf');
    expect(file.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(merged.getPageCount()).toBeGreaterThanOrEqual(2);
  });
});

function printableDocument(): BillingPrintableDocument {
  return {
    invoiceId: 'invoice-1',
    number: 'INV-202606-0001',
    title: 'Счет № INV-202606-0001',
    fileName: 'INV-202606-0001.html',
    status: BillingInvoiceStatus.ISSUED,
    statusLabel: 'Выставлен',
    periodFrom: '2026-06-01T00:00:00.000Z',
    periodTo: '2026-06-30T00:00:00.000Z',
    dueDate: '2026-07-05T00:00:00.000Z',
    issuedAt: '2026-06-26T00:00:00.000Z',
    totalRub: 1250,
    paidRub: 250,
    remainingRub: 1000,
    comment: null,
    client: {
      id: 'client-1',
      code: 'CLIENT',
      name: 'ООО "Клиент"',
      legalName: 'ООО "Клиент"',
      inn: '7700000000',
      kpp: '770001001',
      ogrn: '1027700000000',
      legalAddress: 'Москва',
      actualAddress: 'Москва, склад',
      email: 'client@example.com',
      phone: '+74950000000',
      bankName: 'АО "Тест Банк"',
      bankBik: '044525000',
      bankAccount: '40702810000000000001',
      correspondentAccount: '30101810000000000002',
    },
    rows: [
      {
        position: 1,
        description: 'Хранение товара на складе',
        unit: 'LITER_DAY',
        quantity: 1000,
        unitPriceRub: 1,
        totalRub: 1000,
        serviceDate: '2026-06-20T00:00:00.000Z',
      },
      {
        position: 2,
        description: 'Приемка коробов',
        unit: 'BOX',
        quantity: 10,
        unitPriceRub: 25,
        totalRub: 250,
        serviceDate: '2026-06-21T00:00:00.000Z',
      },
    ],
    payments: [
      {
        id: 'payment-1',
        amountRub: 250,
        paidAt: '2026-06-27T00:00:00.000Z',
        method: 'bank',
        reference: '1',
        comment: null,
      },
    ],
    createdBy: {
      id: 'user-1',
      email: 'manager@example.com',
      name: 'Manager',
    },
    html: '<html></html>',
  };
}

function user(): AuthUser {
  return {
    id: 'user-1',
    email: 'client@example.com',
    name: 'Client',
    roleCodes: ['CLIENT'],
    permissionCodes: ['billing:read'],
    clientScopeMode: 'LIMITED',
    clientIds: ['client-1'],
    writableClientIds: [],
  };
}
