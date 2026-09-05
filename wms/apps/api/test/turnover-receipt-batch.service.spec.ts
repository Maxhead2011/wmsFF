import { MovementType } from '@prisma/client';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

describe('TurnoverService receipt batch export', () => {
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
