import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BillingInvoiceStatus, BillingPaymentStatus, BillingUnit } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { BillingDocumentService } from '../src/modules/billing/billing-document.service';

describe('BillingDocumentService', () => {
  it('С„РѕСЂРјРёСЂСѓРµС‚ РїРµС‡Р°С‚РЅС‹Р№ РґРѕРєСѓРјРµРЅС‚ СЃС‡РµС‚Р° Рё РїСЂРѕРІРµСЂСЏРµС‚ РґРѕСЃС‚СѓРї Рє РєР»РёРµРЅС‚Сѓ', async () => {
    const prisma = {
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue(invoiceFixture()),
      },
    };
    const scopes = {
      requireClientAccess: vi.fn(),
    };
    const service = new BillingDocumentService(prisma as never, scopes as never);

    const document = await service.getInvoiceDocument('invoice-1', user());

    expect(scopes.requireClientAccess).toHaveBeenCalledWith(expect.any(Object), 'client-1', 'read');
    expect(document.number).toBe('INV-202606-0001');
    expect(document.totalRub).toBe(1250);
    expect(document.paidRub).toBe(250);
    expect(document.remainingRub).toBe(1000);
    expect(document.rows).toHaveLength(2);
    expect(document.payments).toHaveLength(1);
    expect(document.html).toContain('Счет на оплату № 1');
    expect(document.html).toContain('РћРћРћ &quot;РљР»РёРµРЅС‚&quot;');
    expect(document.html).toContain('ОГРН: 1027700000000');
    expect(document.html).toContain('Банк: РђРћ &quot;РўРµСЃС‚ Р‘Р°РЅРє&quot;');
    expect(document.html).toContain('Р/с: 40702810000000000001');
    expect(document.html).not.toContain('<script>');
  });

  it('РІРѕР·РІСЂР°С‰Р°РµС‚ 404 РґР»СЏ РѕС‚СЃСѓС‚СЃС‚РІСѓСЋС‰РµРіРѕ СЃС‡РµС‚Р°', async () => {
    const prisma = {
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new BillingDocumentService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await expect(service.getInvoiceDocument('missing', user())).rejects.toThrow(NotFoundException);
  });

  it('С„РѕСЂРјРёСЂСѓРµС‚ Р°РєС‚ РѕРєР°Р·Р°РЅРЅС‹С… СѓСЃР»СѓРі РёР· СЃРЅРёРјРєР° СЃС‡РµС‚Р°', async () => {
    const prisma = {
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue(invoiceFixture()),
      },
    };
    const scopes = {
      requireClientAccess: vi.fn(),
    };
    const service = new BillingDocumentService(prisma as never, scopes as never);

    const document = await service.getInvoiceActDocument('invoice-1', user({ permissionCodes: ['billing:read', 'billing:write'], roleCodes: ['ADMIN'] }));

    expect(scopes.requireClientAccess).toHaveBeenCalledWith(expect.any(Object), 'client-1', 'read');
    expect(document.documentKind).toBe('act');
    expect(document.actNumber).toBe('ACT-202606-0001');
    expect(document.fileName).toBe('ACT-202606-0001.html');
    expect(document.html).toContain('Акт № 1');
    expect(document.html).toContain('Индивидуальный предприниматель Говорова Екатерина Ивановна');
    expect(document.html).toContain('Основание: счет № INV-202606-0001');
    expect(document.html).toContain('К/с: 30101810000000000002');
    expect(document.html).toContain('Итого оказано услуг на сумму');
    expect(document.html).not.toContain('РћРїР»Р°С‚С‹');
  });
  it('blocks act download for client until invoice is paid', async () => {
    const prisma = {
      billingInvoice: {
        findUnique: vi.fn().mockResolvedValue(invoiceFixture()),
      },
    };
    const service = new BillingDocumentService(prisma as never, { requireClientAccess: vi.fn() } as never);

    await expect(service.getInvoiceActDocument('invoice-1', user())).rejects.toThrow(ForbiddenException);
  });
});

function invoiceFixture() {
  return {
    id: 'invoice-1',
    number: 'INV-202606-0001',
    clientId: 'client-1',
    periodFrom: new Date('2026-06-01T00:00:00.000Z'),
    periodTo: new Date('2026-06-30T00:00:00.000Z'),
    dueDate: new Date('2026-07-05T00:00:00.000Z'),
    status: BillingInvoiceStatus.ISSUED,
    totalRub: '1250.00',
    paidRub: '250.00',
    issuedAt: new Date('2026-06-26T00:00:00.000Z'),
    paidAt: null,
    comment: null,
    client: {
      id: 'client-1',
      code: 'CLIENT',
      name: 'РћРћРћ "РљР»РёРµРЅС‚"<script>',
      legalName: 'РћРћРћ "РљР»РёРµРЅС‚"',
      inn: '7700000000',
      kpp: '770001001',
      ogrn: '1027700000000',
      legalAddress: 'РњРѕСЃРєРІР°',
      actualAddress: 'РњРѕСЃРєРІР°, СЃРєР»Р°Рґ',
      email: 'client@example.com',
      phone: '+74950000000',
      bankName: 'РђРћ "РўРµСЃС‚ Р‘Р°РЅРє"',
      bankBik: '044525000',
      bankAccount: '40702810000000000001',
      correspondentAccount: '30101810000000000002',
    },
    createdBy: {
      id: 'user-1',
      email: 'manager@example.com',
      name: 'Manager',
    },
    items: [
      {
        id: 'item-1',
        invoiceId: 'invoice-1',
        chargeId: 'charge-1',
        description: 'РҐСЂР°РЅРµРЅРёРµ',
        unit: BillingUnit.LITER_DAY,
        quantity: '1000.000',
        unitPriceRub: '1.00',
        totalRub: '1000.00',
        serviceDate: new Date('2026-06-20T00:00:00.000Z'),
      },
      {
        id: 'item-2',
        invoiceId: 'invoice-1',
        chargeId: 'charge-2',
        description: 'РџСЂРёРµРјРєР°',
        unit: BillingUnit.BOX,
        quantity: '10.000',
        unitPriceRub: '25.00',
        totalRub: '250.00',
        serviceDate: new Date('2026-06-21T00:00:00.000Z'),
      },
    ],
    payments: [
      {
        id: 'payment-1',
        invoiceId: 'invoice-1',
        clientId: 'client-1',
        amountRub: '250.00',
        paidAt: new Date('2026-06-27T00:00:00.000Z'),
        method: 'bank',
        reference: '1',
        comment: null,
        status: BillingPaymentStatus.RECORDED,
        createdByUserId: 'user-1',
        createdAt: new Date('2026-06-27T00:00:00.000Z'),
        updatedAt: new Date('2026-06-27T00:00:00.000Z'),
      },
    ],
  };
}

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'client@example.com',
    name: 'Client',
    roleCodes: ['CLIENT'],
    permissionCodes: ['billing:read'],
    clientScopeMode: 'LIMITED',
    clientIds: ['client-1'],
    writableClientIds: [],
    ...overrides,
  };
}
