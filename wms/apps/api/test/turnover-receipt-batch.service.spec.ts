import { MovementType } from '@prisma/client';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TurnoverService } from '../src/modules/turnover/turnover.service';
afterEach(() => vi.unstubAllEnvs());

describe('TurnoverService receipt batch export', () => {
  // TEST: the SQL prefix filter and exported workbook must both include real LKBFBO receipts.
  it.each([true, false])('includes LKBFBO receipts only with our flag enabled: %s', async enabled => {
    vi.stubEnv('WMS_RECEIPT_FBO_BATCH_DATE_ENABLED', String(enabled));
    const movements = ['FFL_LKB2409_250', 'FFL_LKBFBO2409_250', 'FFL_LKBFBO2509_251']
      .map((code, i) => ({ ...receiptMovement('m'+i, code), createdAt: new Date('2026-09-25T12:00:00Z') }));
    const prisma = { client: { findUnique: vi.fn(async () => ({id:'client-1',code:'LUKIN',name:'Лукин'})) },
      stockMovement: { findMany: vi.fn(async () => movements) } };
    const service = new TurnoverService(prisma as never, {requireClientAccess:vi.fn()} as never);
    const file = await service.getReceiptPeriodXlsx({clientId:'client-1',receiptBatchDate:'2026-09-24'},adminUser);
    const query = prisma.stockMovement.findMany.mock.calls[0] as any;
    const predicate = query[0].where.AND[0];
    expect(predicate.type).toBe(MovementType.RECEIPT);
    if(enabled) expect(predicate.OR).toEqual([
      {box:{code:{startsWith:'FFL_LKB2409',mode:'insensitive'}}},
      {box:{code:{startsWith:'FFL_LKBFBO2409',mode:'insensitive'}}},
    ]);
    else expect(predicate.box.code.startsWith).toBe('FFL_LKB2409');
    const book=XLSX.read(file.content);
    const values=XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[1]],{header:1}).flat().map(String);
    expect(values.includes('FFL_LKBFBO2409_250')).toBe(enabled);
    expect(values).not.toContain('FFL_LKBFBO2509_251');
  });
  it('exports movements by the date encoded in the box number', async () => {
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'LUKIN', name: 'ИП Лукин' }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          receiptMovement('movement-1807', 'FFL_LKB1807_251'),
          receiptMovement('movement-1907', 'FFL_LKB1907_001'),
        ]),
      },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new TurnoverService(prisma as never, clientScopes as never);

    const file = await service.getReceiptPeriodXlsx(
      { clientId: 'client-1', receiptBatchDate: '2026-07-18' },
      adminUser,
    );

    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          // TEST: preserve all batch predicates inside the warehouse-scope AND composition.
          AND: [{
            clientId: 'client-1',
            quantity: { gt: 0 },
            type: MovementType.RECEIPT,
            box: { code: { startsWith: 'FFL_LKB1807', mode: 'insensitive' } },
          }],
        }),
      }),
    );
    const workbook = XLSX.read(file.content);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[1]], { header: 1 });
    const values = rows.flat().map(String);
    expect(values).toContain('FFL_LKB1807_251');
    expect(values).not.toContain('FFL_LKB1907_001');
    expect(file.fileName).toContain('batch-2026-07-18');
  });
});

function receiptMovement(id: string, boxCode: string) {
  return {
    id,
    clientId: 'client-1',
    skuId: 'sku-1',
    type: MovementType.RECEIPT,
    quantity: 2,
    sourceDocument: 'Онлайн-приемка',
    createdAt: new Date('2026-07-21T07:21:07.500Z'),
    box: { id: `box-${id}`, code: boxCode },
    sku: {
      id: 'sku-1',
      internalSku: 'SKU-1',
      clientSku: 'CLIENT-SKU-1',
      name: 'Костюм',
      color: 'синий',
      size: 'XL',
      barcodes: [{ value: '2052467953793', isPrimary: true }],
    },
    productMarks: [],
  };
}

const adminUser: AuthUser = {
  id: 'admin-1',
  email: 'admin@example.test',
  name: 'Admin',
  roleCodes: ['ADMIN'],
  permissionCodes: ['system:admin'],
  clientScopeMode: 'ALL',
  clientIds: [],
  writableClientIds: [],
};
