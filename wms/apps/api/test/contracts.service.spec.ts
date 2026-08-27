import { describe, expect, it, vi } from 'vitest';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { ContractsService } from '../src/modules/contracts/contracts.service';

vi.mock('../src/modules/contracts/contract-pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/contracts/contract-pdf')>();
  return {
    ...actual,
    renderContractPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-refreshed')),
  };
});

describe('ContractsService: проверка реквизитов', () => {
  it('показывает замены до подтверждения и обновляет только исходный PDF', async () => {
    const contract = {
      id: 'contract-1',
      number: 'ДОГ-1',
      clientId: 'client-1',
      contractDate: new Date('2026-07-01T00:00:00.000Z'),
      wmsUrl: 'https://wms.logoff.pro',
      wmsLogin: 'client@example.com',
      clientSnapshot: party({ legalAddress: 'Старый адрес', bankBik: '000000000' }),
      executorSnapshot: party(),
      signedUploadedAt: new Date('2026-07-02T12:00:00.000Z'),
    };
    const currentClient = {
      id: 'client-1',
      clientKind: 'INDIVIDUAL_ENTREPRENEUR',
      name: 'ИП Клиент',
      legalName: 'ИП Клиент',
      inn: '123456789012',
      kpp: null,
      ogrn: '123456789012345',
      legalAddress: 'Новый адрес',
      actualAddress: null,
      phone: '+7 900 000-00-00',
      email: 'client@example.com',
      bankName: 'Банк',
      bankBik: '111111111',
      bankAccount: '40700000000000000001',
      correspondentAccount: '30100000000000000001',
    };
    const update = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const summary = {
      id: 'contract-1',
      number: 'ДОГ-1',
      clientId: 'client-1',
      signedUploadedAt: contract.signedUploadedAt,
      attachments: [],
      client: { id: 'client-1', code: 'CLIENT', name: 'ИП Клиент', legalName: 'ИП Клиент' },
    };
    const prisma = {
      clientContract: {
        findUnique: vi.fn().mockResolvedValue(contract),
        findMany: vi.fn().mockResolvedValue([summary]),
        update,
      },
      client: {
        findUnique: vi.fn().mockResolvedValue(currentClient),
      },
      ownCompany: {
        findFirst: vi.fn().mockResolvedValue(ownCompany()),
      },
      auditLog: {
        create: auditCreate,
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new ContractsService(prisma as never, new ClientScopeService());
    const admin = {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Администратор',
      roleCodes: ['ADMIN'],
      permissionCodes: ['billing:write'],
      clientScopeMode: 'ALL',
      clientIds: [],
      writableClientIds: [],
    } as never;

    const preview = await service.checkRequisites('contract-1', admin);

    expect(preview).toMatchObject({
      upToDate: false,
      signedFilePresent: true,
      signedFileWillBePreserved: true,
      changes: expect.arrayContaining([
        expect.objectContaining({
          party: 'CLIENT',
          field: 'legalAddress',
          oldValue: 'Старый адрес',
          newValue: 'Новый адрес',
        }),
        expect.objectContaining({
          party: 'CLIENT',
          field: 'bankBik',
          oldValue: '000000000',
          newValue: '111111111',
        }),
      ]),
    });

    const refreshed = await service.refreshRequisites(
      'contract-1',
      { expectedFingerprint: preview.fingerprint, wmsPassword: 'secret-password' },
      admin,
    );

    expect(refreshed.signedFilePreserved).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pdfData: Buffer.from('%PDF-refreshed'),
          clientSnapshot: expect.objectContaining({ legalAddress: 'Новый адрес' }),
        }),
      }),
    );
    expect(update.mock.calls[0]![0].data).not.toHaveProperty('signedPdfData');
    expect(update.mock.calls[0]![0].data).not.toHaveProperty('signedUploadedAt');
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CLIENT_CONTRACT_REQUISITES_REFRESHED',
          entityId: 'contract-1',
          payload: expect.objectContaining({ signedFilePreserved: true }),
        }),
      }),
    );
  });
});

function party(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'INDIVIDUAL_ENTREPRENEUR',
    name: 'ИП Клиент',
    fullName: 'ИП Клиент',
    inn: '123456789012',
    kpp: null,
    ogrn: '123456789012345',
    legalAddress: 'Новый адрес',
    actualAddress: null,
    phone: '+7 900 000-00-00',
    email: 'client@example.com',
    bankName: 'Банк',
    bankBik: '111111111',
    bankAccount: '40700000000000000001',
    correspondentAccount: '30100000000000000001',
    ...overrides,
  };
}

function ownCompany() {
  const snapshot = party();
  return {
    shortName: snapshot.name,
    fullName: snapshot.fullName,
    inn: snapshot.inn,
    kpp: snapshot.kpp,
    ogrn: snapshot.ogrn,
    legalAddress: snapshot.legalAddress,
    phone: snapshot.phone,
    email: snapshot.email,
    bankName: snapshot.bankName,
    bankBik: snapshot.bankBik,
    bankAccount: snapshot.bankAccount,
    correspondentAccount: snapshot.correspondentAccount,
    bankAccounts: [],
  };
}
