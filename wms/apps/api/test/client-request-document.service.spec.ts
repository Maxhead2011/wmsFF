import { NotFoundException } from '@nestjs/common';
import { ClientRequestPriority, ClientRequestStatus, ClientRequestType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { ClientRequestDocumentService } from '../src/modules/client-requests/client-request-document.service';

describe('ClientRequestDocumentService', () => {
  it('формирует документ заявки с табличным составом и проверкой доступа', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(requestFixture()),
      },
    };
    const scopes = {
      requireClientAccess: vi.fn(),
    };
    const service = new ClientRequestDocumentService(prisma as never, scopes as never);

    const document = await service.getRequestDocument('request-1', user());

    expect(scopes.requireClientAccess).toHaveBeenCalledWith(expect.any(Object), 'client-1', 'read');
    expect(document.requestId).toBe('request-1');
    expect(document.statusLabel).toBe('Упакована');
    expect(document.rows).toHaveLength(2);
    expect(document.totalQuantity).toBe(7);
    expect(document.packages).toHaveLength(1);
    expect(document.html).toContain('Заявка №000042');
    expect(document.html).toContain('SKU-1');
    expect(document.html).toContain('PKG-1');
    expect(document.html).not.toContain('<script>');
  });

  it('возвращает 404 для отсутствующей заявки', async () => {
    const prisma = {
      clientRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new ClientRequestDocumentService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await expect(service.getRequestDocument('missing', user())).rejects.toThrow(NotFoundException);
  });
});

function requestFixture() {
  return {
    id: 'request-1',
    number: 42,
    clientId: 'client-1',
    type: ClientRequestType.OUTBOUND,
    status: ClientRequestStatus.PACKED,
    priority: ClientRequestPriority.HIGH,
    title: 'Отгрузка "WB"<script>',
    comment: 'Проверить маркировку',
    contactName: 'Иван',
    contactPhone: '+79990000000',
    destinationCity: 'Казань',
    deliveryAddress: 'Москва',
    desiredDate: new Date('2026-06-30T00:00:00.000Z'),
    managerComment: 'Готово к отгрузке',
    createdAt: new Date('2026-06-26T00:00:00.000Z'),
    updatedAt: new Date('2026-06-26T01:00:00.000Z'),
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
    items: [
      {
        id: 'item-1',
        requestId: 'request-1',
        skuId: 'sku-1',
        barcode: '4600001',
        name: null,
        quantity: 3,
        comment: 'Первая строка',
        sku: {
          id: 'sku-1',
          internalSku: 'SKU-1',
          clientSku: 'C-1',
          article: 'ART-1',
          name: 'Товар 1',
        },
      },
      {
        id: 'item-2',
        requestId: 'request-1',
        skuId: null,
        barcode: '4600002',
        name: 'Ручной товар',
        quantity: 4,
        comment: null,
        sku: null,
      },
    ],
    packages: [
      {
        id: 'package-1',
        requestId: 'request-1',
        clientId: 'client-1',
        packageCode: 'PKG-1',
        packageType: 'BOX',
        weightGrams: 1200,
        lengthCm: 40,
        widthCm: 30,
        heightCm: 20,
        comment: 'Основное место',
        createdByUserId: 'user-operator',
        createdBy: {
          id: 'user-operator',
          email: 'operator@example.com',
          name: 'Оператор',
        },
        items: [
          {
            id: 'package-item-1',
            packageId: 'package-1',
            requestItemId: 'item-1',
            skuId: 'sku-1',
            barcode: '4600001',
            quantity: 3,
            requestItem: {
              id: 'item-1',
              barcode: '4600001',
              name: null,
              quantity: 3,
              sku: {
                id: 'sku-1',
                internalSku: 'SKU-1',
                name: 'Товар 1',
              },
            },
            sku: {
              id: 'sku-1',
              internalSku: 'SKU-1',
              name: 'Товар 1',
            },
          },
        ],
      },
    ],
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
