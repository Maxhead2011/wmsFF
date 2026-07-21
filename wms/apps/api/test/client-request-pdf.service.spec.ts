import { ClientRequestPriority, ClientRequestStatus, ClientRequestType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import type { ClientRequestPrintableDocument } from '../src/modules/client-requests/client-request-document.service';
import { ClientRequestPdfService } from '../src/modules/client-requests/client-request-pdf.service';

describe('ClientRequestPdfService', () => {
  it('формирует PDF заявки из печатного снимка', async () => {
    const documents = {
      getRequestDocument: vi.fn().mockResolvedValue(printableDocument()),
    };
    const service = new ClientRequestPdfService(documents as never);

    const file = await service.getRequestPdf('request-1', user());

    expect(documents.getRequestDocument).toHaveBeenCalledWith('request-1', expect.any(Object));
    expect(file.fileName).toBe('request-outbound-0001.pdf');
    expect(file.contentType).toBe('application/pdf');
    expect(file.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(file.buffer.length).toBeGreaterThan(4000);
  });
});

function printableDocument(): ClientRequestPrintableDocument {
  return {
    requestId: 'request-1',
    requestNumber: 42,
    title: 'Заявка Отгрузка WB',
    fileName: 'request-outbound-0001.html',
    type: ClientRequestType.OUTBOUND,
    typeLabel: 'Отгрузка',
    status: ClientRequestStatus.PACKED,
    statusLabel: 'Упакована',
    priority: ClientRequestPriority.HIGH,
    priorityLabel: 'Высокий',
    createdAt: '2026-06-26T00:00:00.000Z',
    updatedAt: '2026-06-26T01:00:00.000Z',
    desiredDate: '2026-06-30T00:00:00.000Z',
    comment: 'Проверить маркировку',
    managerComment: 'Готово к отгрузке',
    contactName: 'Иван',
    contactPhone: '+79990000000',
    destinationCity: 'Казань',
    deliveryAddress: 'Москва',
    rowsCount: 2,
    totalQuantity: 7,
    client: {
      id: 'client-1',
      code: 'CLIENT',
      name: 'ООО "Клиент"',
      inn: '7700000000',
      kpp: '770001001',
      legalAddress: 'Москва',
      actualAddress: null,
      email: 'client@example.com',
      phone: null,
    },
    rows: [
      {
        position: 1,
        skuId: 'sku-1',
        internalSku: 'SKU-1',
        clientSku: 'C-1',
        article: 'ART-1',
        barcode: '4600001',
        name: 'Товар 1',
        quantity: 3,
        comment: 'Первая строка',
      },
      {
        position: 2,
        skuId: null,
        internalSku: null,
        clientSku: null,
        article: null,
        barcode: '4600002',
        name: 'Ручной товар',
        quantity: 4,
        comment: null,
      },
    ],
    packages: [
      {
        id: 'package-1',
        packageCode: 'PKG-1',
        packageType: 'BOX',
        weightGrams: 1200,
        lengthCm: 40,
        widthCm: 30,
        heightCm: 20,
        comment: 'Основное место',
        items: [
          {
            requestItemId: 'item-1',
            skuId: 'sku-1',
            internalSku: 'SKU-1',
            name: 'Товар 1',
            barcode: '4600001',
            quantity: 3,
          },
        ],
      },
    ],
    createdBy: {
      id: 'user-client',
      email: 'client@example.com',
      name: 'Клиент',
    },
    assignedTo: {
      id: 'user-operator',
      email: 'operator@example.com',
      name: 'Оператор',
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
    permissionCodes: ['client-requests:read'],
    clientScopeMode: 'LIMITED',
    clientIds: ['client-1'],
    writableClientIds: [],
  };
}
